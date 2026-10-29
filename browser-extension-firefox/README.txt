Firefox copy of the Capri Browser Link. It uses the same background.js as ../browser-extension
(Capri copies it here when she starts). Load it from about:debugging -> This Firefox -> Load Temporary Add-on
-> pick manifest.json here. Then in about:addons -> Capri Browser Link -> Permissions, turn on
"Access your data for all websites". Firefox forgets temporary add-ons when it closes, so load it again after
a restart (or use Firefox Developer Edition / Nightly to keep it).
