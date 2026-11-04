# Capri's hands on Windows: a long-running helper that src/pc.js talks to (one JSON request per line on stdin,
# one JSON answer per line on stdout). It sees apps through UI Automation (the accessibility tree: buttons, fields,
# text and where they are on screen) and moves the mouse / types with SendInput.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, Microsoft.VisualBasic
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class CapriWin {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Explicit)] struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputUnion u; }
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  public static void Key(byte vk, bool up) { keybd_event(vk, 0, up ? 2u : 0u, UIntPtr.Zero); }
  public static void TypeText(string s) {
    foreach (char c in s) {
      if (c == '\r') continue;
      if (c == '\n') { Key(0x0D, false); Key(0x0D, true); System.Threading.Thread.Sleep(8); continue; }
      if (c == '\t') { Key(0x09, false); Key(0x09, true); System.Threading.Thread.Sleep(8); continue; }
      INPUT down = new INPUT(); down.type = 1; down.u.ki = new KEYBDINPUT { wScan = c, dwFlags = 4 };
      INPUT up = new INPUT(); up.type = 1; up.u.ki = new KEYBDINPUT { wScan = c, dwFlags = 4 | 2 };
      SendInput(2, new INPUT[] { down, up }, Marshal.SizeOf(typeof(INPUT)));
      System.Threading.Thread.Sleep(6);
    }
  }
  // bring a window to the front even when Windows' focus-stealing rules say no (a tap of Alt unlocks it)
  public static void Front(IntPtr h) {
    if (IsIconic(h)) ShowWindow(h, 9);
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
    SetForegroundWindow(h);
  }
}
"@
[void][CapriWin]::SetProcessDPIAware()

# the window in front: its title, process, and whether it sits on the main screen / covers it (Capri's activity sense).
# Its own type, so if it ever fails to compile, the rest of the helper still works.
$fgError = $null
try {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class CapriFg {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
  [StructLayout(LayoutKind.Sequential)] struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO li);
  public static string Title(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
  public static uint IdleMs() { var li = new LASTINPUTINFO(); li.cbSize = (uint)Marshal.SizeOf(li); GetLastInputInfo(ref li); return (uint)Environment.TickCount - li.dwTime; }
  // [onPrimary, fullscreen]
  public static bool[] Screen(IntPtr h) {
    RECT r; GetWindowRect(h, out r);
    var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(mi);
    GetMonitorInfo(MonitorFromWindow(h, 2), ref mi);
    bool full = r.L <= mi.rcMonitor.L && r.T <= mi.rcMonitor.T && r.R >= mi.rcMonitor.R && r.B >= mi.rcMonitor.B;
    return new bool[] { (mi.dwFlags & 1) != 0, full };
  }
}
"@
} catch { $fgError = $_.Exception.Message }
$UIA = [System.Windows.Automation.AutomationElement]
$CT = [System.Windows.Automation.ControlType]
$capriPid = [int]$args[0]

$VK = @{ ctrl = 0x11; control = 0x11; alt = 0x12; shift = 0x10; win = 0x5B; windows = 0x5B; enter = 0x0D; return = 0x0D; tab = 0x09;
  esc = 0x1B; escape = 0x1B; space = 0x20; backspace = 0x08; delete = 0x2E; del = 0x2E; insert = 0x2D; home = 0x24; end = 0x23;
  pageup = 0x21; pagedown = 0x22; up = 0x26; down = 0x28; left = 0x25; right = 0x27; printscreen = 0x2C; capslock = 0x14;
  volumeup = 0xAF; volumedown = 0xAE; mute = 0xAD; playpause = 0xB3; nexttrack = 0xB0; prevtrack = 0xB1 }
for ($i = 1; $i -le 12; $i++) { $VK["f$i"] = 0x6F + $i }

function Win-Info($w) {
  $c = $w.Current
  @{ title = $c.Name; process = (Get-Process -Id $c.ProcessId -ErrorAction SilentlyContinue).ProcessName; hwnd = [int64]$c.NativeWindowHandle;
     focused = ([int64]$c.NativeWindowHandle -eq [int64][CapriWin]::GetForegroundWindow()); minimized = [CapriWin]::IsIconic([IntPtr][int64]$c.NativeWindowHandle) }
}
function All-Windows {
  $cond = New-Object System.Windows.Automation.PropertyCondition($UIA::ControlTypeProperty, $CT::Window)
  $UIA::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond) |
    Where-Object { $_.Current.ProcessId -ne $capriPid -and $_.Current.Name } | Select-Object -First 40
}
function Find-Window($title) {
  $wins = @(All-Windows)
  if ($title) {
    $t = $title.ToLower()
    $hit = $wins | Where-Object { $_.Current.Name.ToLower().Contains($t) } | Select-Object -First 1
    if (-not $hit) { $hit = $wins | Where-Object { ((Get-Process -Id $_.Current.ProcessId -ErrorAction SilentlyContinue).ProcessName + '').ToLower().Contains($t) } | Select-Object -First 1 }
    if (-not $hit) { throw "No open window matches '$title'." }
    return $hit
  }
  $fg = [int64][CapriWin]::GetForegroundWindow()
  $hit = $wins | Where-Object { [int64]$_.Current.NativeWindowHandle -eq $fg } | Select-Object -First 1
  if (-not $hit) { $hit = $wins | Select-Object -First 1 }
  if (-not $hit) { throw 'No app window is open.' }
  return $hit
}

$INTEREST = @('Button', 'CheckBox', 'ComboBox', 'Edit', 'Hyperlink', 'ListItem', 'MenuItem', 'RadioButton', 'TabItem', 'TreeItem',
  'SplitButton', 'Slider', 'Spinner', 'DataItem', 'Text', 'Document', 'MenuBar', 'Menu', 'ToolBar')
function Read-Window($w, $max) {
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $out = New-Object System.Collections.ArrayList
  $stack = New-Object System.Collections.Stack
  $stack.Push(@($w, 0))
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ($stack.Count -gt 0 -and $out.Count -lt $max -and $sw.ElapsedMilliseconds -lt 4000) {
    $pair = $stack.Pop(); $el = $pair[0]; $depth = $pair[1]
    try {
      $c = $el.Current
      $type = $c.ControlType.ProgrammaticName -replace '^ControlType\.', ''
      $r = $c.BoundingRectangle
      if (-not $c.IsOffscreen -and -not $r.IsEmpty -and $r.Width -gt 1 -and $INTEREST -contains $type -and ($c.Name -or $type -eq 'Edit' -or $type -eq 'Document')) {
        $e = @{ type = $type; name = ($c.Name + '').Substring(0, [Math]::Min(80, ($c.Name + '').Length)); x = [int]($r.X + $r.Width / 2); y = [int]($r.Y + $r.Height / 2);
                w = [int]$r.Width; h = [int]$r.Height; enabled = $c.IsEnabled; password = $c.IsPassword; focused = $c.HasKeyboardFocus }
        if (($type -eq 'Edit' -or $type -eq 'ComboBox') -and -not $c.IsPassword) {
          try { $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); $v = $vp.Current.Value + ''; $e.value = $v.Substring(0, [Math]::Min(120, $v.Length)) } catch { }
        }
        if ($type -eq 'CheckBox' -or $type -eq 'RadioButton') {
          try { $tp = $el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern); $e.checked = ($tp.Current.ToggleState -eq 'On') } catch { }
          try { $sp = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern); $e.checked = $sp.Current.IsSelected } catch { }
        }
        [void]$out.Add($e)
      }
      if ($depth -lt 30) {
        $kids = New-Object System.Collections.ArrayList
        $ch = $walker.GetFirstChild($el)
        while ($ch -ne $null -and $kids.Count -lt 400) { [void]$kids.Add($ch); $ch = $walker.GetNextSibling($ch) }
        for ($k = $kids.Count - 1; $k -ge 0; $k--) { $stack.Push(@($kids[$k], $depth + 1)) }
      }
    } catch { }
  }
  # long text of a document/editor that has focus (Notepad, Word…)
  $text = ''
  try {
    $f = $UIA::FocusedElement
    if ($f -and -not $f.Current.IsPassword) {
      $tp = $f.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
      $text = $tp.DocumentRange.GetText(6000)
    }
  } catch { }
  return @{ window = (Win-Info $w); elements = $out; text = $text; truncated = ($out.Count -ge $max) }
}

function Click($x, $y, $button, $double) {
  [void][CapriWin]::SetCursorPos($x, $y)
  Start-Sleep -Milliseconds 40
  $down = 2; $up = 4
  if ($button -eq 'right') { $down = 8; $up = 16 } elseif ($button -eq 'middle') { $down = 32; $up = 64 }
  $n = 1; if ($double) { $n = 2 }
  for ($i = 0; $i -lt $n; $i++) { [CapriWin]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero); [CapriWin]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60 }
}
function Press($combo) {
  $parts = @(($combo + '').ToLower() -split '\s*\+\s*' | Where-Object { $_ })
  $codes = @()
  foreach ($p in $parts) {
    if ($VK.ContainsKey($p)) { $codes += $VK[$p] }
    elseif ($p.Length -eq 1) { $codes += [int][char]$p.ToUpper() }
    else { throw "I don't know the key '$p'." }
  }
  foreach ($c in $codes) { [CapriWin]::Key([byte]$c, $false); Start-Sleep -Milliseconds 15 }
  for ($i = $codes.Count - 1; $i -ge 0; $i--) { [CapriWin]::Key([byte]$codes[$i], $true); Start-Sleep -Milliseconds 15 }
}

function Handle($q) {
  switch ($q.cmd) {
    'windows' { return @{ windows = @(All-Windows | ForEach-Object { Win-Info $_ }) } }
    'read' { $w = Find-Window $q.title; $m = 160; if ($q.max) { $m = [int]$q.max }; return (Read-Window $w $m) }
    'focus' { $w = Find-Window $q.title; [CapriWin]::Front([IntPtr][int64]$w.Current.NativeWindowHandle); Start-Sleep -Milliseconds 250; return @{ window = (Win-Info $w) } }
    'window' {
      $w = Find-Window $q.title; $h = [IntPtr][int64]$w.Current.NativeWindowHandle
      switch ($q.action) {
        'minimize' { [void][CapriWin]::ShowWindow($h, 6) }
        'maximize' { [void][CapriWin]::ShowWindow($h, 3) }
        'restore' { [void][CapriWin]::ShowWindow($h, 9) }
        'close' { [void][CapriWin]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
        default { [CapriWin]::Front($h) }
      }
      return @{ window = (Win-Info $w) }
    }
    'front' { [CapriWin]::Front([IntPtr][int64]$q.hwnd); Start-Sleep -Milliseconds 200; return @{ front = $true } }
    'focused' {
      $f = $UIA::FocusedElement
      if (-not $f) { return @{ } }
      return @{ type = ($f.Current.ControlType.ProgrammaticName -replace '^ControlType\.', ''); name = $f.Current.Name; password = $f.Current.IsPassword }
    }
    'click' { Click ([int]$q.x) ([int]$q.y) $q.button ([bool]$q.double); return @{ clicked = $true } }
    'type' {
      $f = $UIA::FocusedElement
      if ($f -and $f.Current.IsPassword) { throw 'The focused field is a password field. Capri never types passwords.' }
      [CapriWin]::TypeText([string]$q.text); return @{ typed = $true }
    }
    'key' { Press $q.keys; return @{ pressed = $q.keys } }
    'scroll' {
      if ($q.x) { [void][CapriWin]::SetCursorPos([int]$q.x, [int]$q.y) }
      $n = 5; if ($q.amount) { $n = [int]$q.amount }
      $d = 120; if ($q.direction -eq 'down') { $d = -120 }
      for ($i = 0; $i -lt $n; $i++) { [CapriWin]::mouse_event(0x0800, 0, 0, $d, [UIntPtr]::Zero); Start-Sleep -Milliseconds 20 }
      return @{ scrolled = $q.direction }
    }
    'recycle' {
      $p = [string]$q.path
      if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }
      else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }
      return @{ recycled = $p }
    }
    'foreground' {
      # cheap (no UI Automation): Capri checks this every few seconds when "notice what I'm doing" is on
      if ($fgError) { throw "foreground check unavailable: $fgError" }
      $h = [CapriWin]::GetForegroundWindow()
      $idle = [CapriFg]::IdleMs()
      if ($h -eq [IntPtr]::Zero) { return @{ none = $true; idle = $idle } }
      [uint32]$procId = 0; [void][CapriFg]::GetWindowThreadProcessId($h, [ref]$procId)
      if ([int]$procId -eq $capriPid) { return @{ self = $true; idle = $idle } }
      $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
      $exe = ''; try { $exe = [string]$p.Path } catch { }
      $scr = [CapriFg]::Screen($h)
      return @{ title = [CapriFg]::Title($h); process = [string]$p.ProcessName; path = $exe; primary = $scr[0]; fullscreen = $scr[1]; idle = $idle }
    }
    'ping' { return @{ pong = $true } }
    default { throw "Unknown command $($q.cmd)" }
  }
}

[Console]::Out.WriteLine('{"ready":true}'); [Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  if (-not $line.Trim()) { continue }
  $q = $null
  try { $q = $line | ConvertFrom-Json; $res = Handle $q; $o = @{ id = $q.id; ok = $true; result = $res } }
  catch { $o = @{ id = $(if ($q) { $q.id } else { 0 }); ok = $false; error = $_.Exception.Message } }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 8)); [Console]::Out.Flush()
}
