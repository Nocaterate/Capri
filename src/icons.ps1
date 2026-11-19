# Real app icons for Capri's Hub. Reads "name<TAB>parsing name" lines from the file in $args[0] (an exe or .lnk
# path, or shell:AppsFolder\<AppID> for anything in the Start menu, Store apps too) and saves each icon as a
# 64x64 PNG <name>.png in the folder $args[1], through the Windows shell (IShellItemImageFactory, icon only).
# Prints one JSON line per icon. Runs as its own short process so it never blocks Capri's main helper.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.IO;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class CapriIcon {
  [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IShellItemImageFactory { [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm); }
  [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx; public int cy; }
  [StructLayout(LayoutKind.Sequential)] struct BITMAP { public int bmType, bmWidth, bmHeight, bmWidthBytes; public ushort bmPlanes, bmBitsPixel; public IntPtr bmBits; }
  [StructLayout(LayoutKind.Sequential)] struct BITMAPINFOHEADER { public int biSize, biWidth, biHeight; public short biPlanes, biBitCount; public int biCompression, biSizeImage, biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant; }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
  static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory ppv);
  [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int c, ref BITMAP bm);
  [DllImport("gdi32.dll")] static extern int GetDIBits(IntPtr hdc, IntPtr hbm, uint start, uint lines, byte[] bits, ref BITMAPINFOHEADER bi, uint usage);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);

  public static void Save(string parsingName, int size, string outFile) {
    IShellItemImageFactory f;
    SHCreateItemFromParsingName(parsingName, IntPtr.Zero, typeof(IShellItemImageFactory).GUID, out f);
    SIZE s; s.cx = size; s.cy = size;
    IntPtr hbm;
    int hr = f.GetImage(s, 0x4 /* icon only */, out hbm);
    if (hr != 0) hr = f.GetImage(s, 0x0, out hbm);
    if (hr != 0) throw new Exception("no image (0x" + hr.ToString("X") + ")");
    try {
      BITMAP bm = new BITMAP(); GetObject(hbm, Marshal.SizeOf(typeof(BITMAP)), ref bm);
      int w = bm.bmWidth, h = Math.Abs(bm.bmHeight);
      BITMAPINFOHEADER bi = new BITMAPINFOHEADER();
      bi.biSize = 40; bi.biWidth = w; bi.biHeight = -h; bi.biPlanes = 1; bi.biBitCount = 32;
      byte[] px = new byte[w * h * 4];
      IntPtr dc = GetDC(IntPtr.Zero);
      try { GetDIBits(dc, hbm, 0, (uint)h, px, ref bi, 0); } finally { ReleaseDC(IntPtr.Zero, dc); }
      bool anyAlpha = false, premul = true;
      for (int i = 0; i < px.Length; i += 4) {
        byte a = px[i + 3];
        if (a != 0) anyAlpha = true;
        if (px[i] > a || px[i + 1] > a || px[i + 2] > a) premul = false;
      }
      for (int i = 0; i < px.Length; i += 4) {
        if (!anyAlpha) { px[i + 3] = 255; continue; }
        byte a = px[i + 3];
        if (premul && a > 0 && a < 255) {
          px[i] = (byte)Math.Min(255, px[i] * 255 / a); px[i + 1] = (byte)Math.Min(255, px[i + 1] * 255 / a); px[i + 2] = (byte)Math.Min(255, px[i + 2] * 255 / a);
        }
      }
      using (Bitmap b = new Bitmap(w, h, PixelFormat.Format32bppArgb)) {
        BitmapData d = b.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        for (int y = 0; y < h; y++) Marshal.Copy(px, y * w * 4, IntPtr.Add(d.Scan0, y * d.Stride), w * 4);
        b.UnlockBits(d);
        b.Save(outFile, ImageFormat.Png);
      }
    } finally { DeleteObject(hbm); }
  }
}
"@
$list = Get-Content -LiteralPath $args[0] -Encoding UTF8
$dir = $args[1]
foreach ($line in $list) {
  if (-not $line) { continue }
  $name, $target = $line -split "`t", 2
  try {
    [CapriIcon]::Save($target, 64, (Join-Path $dir "$name.png"))
    [Console]::Out.WriteLine((@{ key = $name; ok = $true } | ConvertTo-Json -Compress))
  } catch {
    [Console]::Out.WriteLine((@{ key = $name; ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress))
  }
  [Console]::Out.Flush()
}
