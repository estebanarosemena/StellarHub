/* StellarHub · App Hangar: pick the apps you want and install them all at once with winget (like Ninite or winstall).
   Inside the app everything is REAL (stellarhub/engine/hangar.py): what is installed, winget search, icons, installs.
   Outside the app (browser, design tests) the same screens run on sample data and the queue is simulated. */
'use strict';
(() => {
const { $, $$, state, Spring, EASE, anim, tickers, ic, esc, fmt1 } = SH;
const t = SH.t;
const U = SH.unit;
const ID = 'hangar';
SH.icons.add({
  'hg-chat': '<path d="M20 11.5a7.5 7 0 0 1-11 6.2L4.5 19l1.3-3.6A7 7 0 1 1 20 11.5z"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01"/>',
  'hg-music': '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  'hg-pad': '<rect x="2.5" y="7" width="19" height="11" rx="5"/><path d="M7.5 10.5v4M5.5 12.5h4M15.5 11.5h.01M18 13.5h.01"/>',
  'hg-brief': '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8.5 7V5.2c0-.9.7-1.7 1.7-1.7h3.6c1 0 1.7.8 1.7 1.7V7M3 12.5h18"/>',
  'hg-cap': '<path d="m2.5 9.5 9.5-5 9.5 5-9.5 5z"/><path d="M6.5 11.6v4.4c3 2.6 8 2.6 11 0v-4.4M21.5 9.5v5"/>',
  'hg-rocket': '<path d="M12 2.8c2.9 2 4.3 5.3 4.3 9.2v3.7H7.7V12c0-3.9 1.4-7.2 4.3-9.2z"/><circle cx="12" cy="9.6" r="1.6"/><path d="M7.7 12.8 5 15.6v3.1l2.7-1.6M16.3 12.8l2.7 2.8v3.1l-2.7-1.6M10.2 18.8 12 21.4l1.8-2.6"/>',
  'hg-share': '<circle cx="6" cy="12" r="2.5"/><circle cx="17.5" cy="6" r="2.5"/><circle cx="17.5" cy="18" r="2.5"/><path d="m8.3 10.8 7-3.6M8.3 13.2l7 3.6"/>',
  'hg-code': '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 10h.01M7 14h.01M10.5 10h6.5M10.5 14h4"/>',
});
let REAL = false;
SH.apiReady.then(a => { REAL = !!a; });
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const STORE_RE = /^[0-9A-Z]{12}$/;
const wait = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- categories ---------------- */
const CATS = [
  ['browsers', t('Browsers'), 'globe'], ['communication', t('Communication'), 'hg-chat'], ['media', t('Media & music'), 'hg-music'],
  ['creative', t('Creative'), 'palette'], ['gaming', t('Gaming'), 'hg-pad'], ['dev', t('Development'), 'code'],
  ['productivity', t('Productivity'), 'hg-brief'], ['utilities', t('Utilities'), 'wrench'], ['security', t('Security & privacy'), 'shield'],
  ['runtimes', t('Runtimes'), 'layers'],
].map(([id, n, icn]) => ({ id, n, ic: icn }));
const CAT = Object.fromEntries(CATS.map(c => [c.id, c]));

/* ---------------- the catalog ----------------
   Every winget id here was checked with `winget show --id <id> -e`. ORDER MATTERS: an app's position is its number in
   share codes, so only ever append at the end; to retire an app, replace its entry with null.
   The last field is an icon URL, only where winstall's icon API (the default, keyed by id) has none or a poor one. */
const A = (id, name, pub, cat, desc, icon) => ({ id, name, pub, cat, desc, icon, source: STORE_RE.test(id) ? 'msstore' : 'winget' });
const CATALOG = [
/* browsers */
  A('Google.Chrome', 'Google Chrome', 'Google', 'browsers', t('Fast browser that syncs with your Google account.')),
  A('Mozilla.Firefox', 'Firefox', 'Mozilla', 'browsers', t('Open-source browser that puts privacy first.')),
  A('Brave.Brave', 'Brave', 'Brave Software', 'browsers', t('Chromium browser that blocks ads and trackers.')),
  A('Microsoft.Edge', 'Microsoft Edge', 'Microsoft', 'browsers', t('The Windows browser, built on Chromium.'), 'https://github.com/MicrosoftEdge.png?size=128'),
  A('Vivaldi.Vivaldi', 'Vivaldi', 'Vivaldi Technologies', 'browsers', t('A browser you can shape to the way you work.')),
  A('Opera.Opera', 'Opera', 'Opera', 'browsers', t('Browser with a built-in VPN and ad blocker.')),
  A('Opera.OperaGX', 'Opera GX', 'Opera', 'browsers', t('Browser made for gamers, with CPU and RAM limits.')),
  A('LibreWolf.LibreWolf', 'LibreWolf', 'LibreWolf', 'browsers', t('Firefox fork hardened for privacy.')),
  A('Zen-Team.Zen-Browser', 'Zen Browser', 'Zen Team', 'browsers', t('Calm, Firefox-based browser with vertical tabs.')),
  A('TorProject.TorBrowser', 'Tor Browser', 'The Tor Project', 'browsers', t('Browse anonymously through the Tor network.')),
  /* communication */
  A('Discord.Discord', 'Discord', 'Discord Inc.', 'communication', t('Voice, video and text chat for communities.')),
  A('Telegram.TelegramDesktop', 'Telegram', 'Telegram', 'communication', t('Fast messaging that syncs across devices.')),
  A('9NKSQGP7F2NH', 'WhatsApp', 'WhatsApp Inc.', 'communication', t('Messages and calls from your phone, on the PC.'), 'https://i.postimg.cc/jjzdZ4GZ/WhatsApp.png'),
  A('OpenWhisperSystems.Signal', 'Signal', 'Signal Foundation', 'communication', t('Private messaging with end-to-end encryption.')),
  A('SlackTechnologies.Slack', 'Slack', 'Slack Technologies', 'communication', t('Channels and messages for teams.')),
  A('Microsoft.Teams', 'Microsoft Teams', 'Microsoft', 'communication', t('Chat, meetings and calls for work and school.'), 'https://i.ibb.co/1YT66G0j/teams.png'),
  A('Zoom.Zoom', 'Zoom', 'Zoom', 'communication', t('Video meetings and webinars.')),
  A('Mozilla.Thunderbird', 'Thunderbird', 'Mozilla', 'communication', t('Free email client with calendar and contacts.')),
  A('Rakuten.Viber', 'Viber', 'Rakuten', 'communication', t('Free calls and messages.')),
  A('TeamSpeakSystems.TeamSpeakClient', 'TeamSpeak', 'TeamSpeak Systems', 'communication', t('Low-latency voice chat for gaming.')),
  /* media */
  A('VideoLAN.VLC', 'VLC media player', 'VideoLAN', 'media', t('Plays almost any video or audio file.')),
  A('Spotify.Spotify', 'Spotify', 'Spotify', 'media', t('Music and podcasts streaming.')),
  A('clsid2.mpc-hc', 'MPC-HC', 'MPC-HC Team', 'media', t('Light, classic video player.'), 'https://api.winstall.app/icons/next/CodecGuide.K-LiteCodecPack.Standard.webp'),
  A('Daum.PotPlayer', 'PotPlayer', 'Kakao', 'media', t('Video player with many advanced options.')),
  A('PeterPawlowski.foobar2000', 'foobar2000', 'Peter Pawlowski', 'media', t('Lightweight, highly customizable music player.')),
  A('Audacity.Audacity', 'Audacity', 'Audacity Team', 'media', t('Record and edit audio.')),
  A('HandBrake.HandBrake', 'HandBrake', 'HandBrake Team', 'media', t('Convert videos to other formats.')),
  A('CodecGuide.K-LiteCodecPack.Standard', 'K-Lite Codec Pack', 'Codec Guide', 'media', t('Codecs so Windows plays every format.')),
  A('Plex.Plex', 'Plex', 'Plex', 'media', t('Your movies, shows and music in one place.')),
  A('Jellyfin.JellyfinMediaPlayer', 'Jellyfin Media Player', 'Jellyfin', 'media', t('Player for your own Jellyfin server.'), 'https://github.com/jellyfin.png?size=128'),
  A('XBMCFoundation.Kodi', 'Kodi', 'XBMC Foundation', 'media', t('Media center for your movies and music.')),
  A('IrfanSkiljan.IrfanView', 'IrfanView', 'Irfan Skiljan', 'media', t('Fast, compact image viewer.')),
  A('DuongDieuPhap.ImageGlass', 'ImageGlass', 'Duong Dieu Phap', 'media', t('Modern image viewer for many formats.')),
  A('MediaArea.MediaInfo.GUI', 'MediaInfo', 'MediaArea', 'media', t('Technical details of any video or audio file.')),
  A('Apple.iTunes', 'iTunes', 'Apple', 'media', t('Music library and iPhone backups.')),
  /* creative */
  A('GIMP.GIMP.3', 'GIMP', 'The GIMP Team', 'creative', t('Free image editor for photos and graphics.')),
  A('dotPDN.PaintDotNet', 'Paint.NET', 'dotPDN', 'creative', t('Simple, powerful image editing.')),
  A('KDE.Krita', 'Krita', 'Krita Foundation', 'creative', t('Digital painting for artists.')),
  A('Inkscape.Inkscape', 'Inkscape', 'Inkscape', 'creative', t('Vector graphics and illustration.')),
  A('BlenderFoundation.Blender', 'Blender', 'Blender Foundation', 'creative', t('3D modeling, animation and rendering.'), 'https://github.com/blender.png?size=128'),
  A('OBSProject.OBSStudio', 'OBS Studio', 'OBS Project', 'creative', t('Record your screen and stream live.')),
  A('Meltytech.Shotcut', 'Shotcut', 'Meltytech', 'creative', t('Free, open-source video editor.')),
  A('KDE.Kdenlive', 'Kdenlive', 'KDE', 'creative', t('Video editing with multiple tracks.')),
  A('darktable.darktable', 'darktable', 'darktable', 'creative', t('Develop and organize RAW photos.')),
  A('Figma.Figma', 'Figma', 'Figma', 'creative', t('Interface design and prototyping.')),
  A('FreeCAD.FreeCAD', 'FreeCAD', 'FreeCAD', 'creative', t('Parametric 3D modeling for makers.')),
  A('LMMS.LMMS', 'LMMS', 'LMMS', 'creative', t('Make music: beats, synths and samples.')),
  A('Upscayl.Upscayl', 'Upscayl', 'Upscayl Team', 'creative', t('Upscale images with AI, on your PC.')),
  /* gaming */
  A('Valve.Steam', 'Steam', 'Valve', 'gaming', t('The biggest PC game store and launcher.')),
  A('EpicGames.EpicGamesLauncher', 'Epic Games Launcher', 'Epic Games', 'gaming', t("Epic's store, with free games every week."), 'https://github.com/EpicGames.png?size=128'),
  A('GOG.Galaxy', 'GOG Galaxy', 'GOG', 'gaming', t('DRM-free games and all your libraries together.')),
  A('Ubisoft.Connect', 'Ubisoft Connect', 'Ubisoft', 'gaming', t('Launcher for Ubisoft games.')),
  A('ElectronicArts.EADesktop', 'EA app', 'Electronic Arts', 'gaming', t('Launcher for EA games.')),
  A('Blizzard.BattleNet', 'Battle.net', 'Blizzard', 'gaming', t('Launcher for Blizzard and Activision games.')),
  A('Playnite.Playnite', 'Playnite', 'Josef Nemec', 'gaming', t('One library for games from every launcher.')),
  A('HeroicGamesLauncher.HeroicGamesLauncher', 'Heroic Games Launcher', 'Heroic', 'gaming', t('Open-source launcher for Epic, GOG and Amazon.'), 'https://github.com/Heroic-Games-Launcher.png?size=128'),
  A('9MV0B5HZVK9Z', 'Xbox', 'Microsoft', 'gaming', t('Game Pass, your Xbox friends and PC games.'), 'https://github.com/xbox.png?size=128'),
  A('Guru3D.Afterburner', 'MSI Afterburner', 'MSI', 'gaming', t('Overclocking and an in-game performance overlay.'), 'https://www.google.com/s2/favicons?domain=msi.com&sz=128'),
  A('Parsec.Parsec', 'Parsec', 'Parsec', 'gaming', t('Play and work on a remote PC with low latency.')),
  A('MoonlightGameStreamingProject.Moonlight', 'Moonlight', 'Moonlight', 'gaming', t('Stream games from your gaming PC.')),
  A('Overwolf.CurseForge', 'CurseForge', 'Overwolf', 'gaming', t('Find and manage game mods.')),
  A('PrismLauncher.PrismLauncher', 'Prism Launcher', 'Prism Launcher', 'gaming', t('Manage several Minecraft instances.'), 'https://github.com/PrismLauncher.png?size=128'),
  A('Mojang.MinecraftLauncher', 'Minecraft Launcher', 'Mojang', 'gaming', t('The official Minecraft launcher.'), 'https://cdn2.steamgriddb.com/icon/b7a782741f667201b54880c925faec4b.png'),
  /* dev */
  A('Microsoft.VisualStudioCode', 'Visual Studio Code', 'Microsoft', 'dev', t('Code editor with extensions for everything.')),
  A('Git.Git', 'Git', 'The Git Project', 'dev', t('Version control for your code.')),
  A('GitHub.GitHubDesktop', 'GitHub Desktop', 'GitHub', 'dev', t('Git without the command line.')),
  A('GitHub.cli', 'GitHub CLI', 'GitHub', 'dev', t('GitHub from your terminal.'), 'https://github.com/cli.png?size=128'),
  A('Python.Python.3.13', 'Python 3.13', 'Python Software Foundation', 'dev', t('The Python language and pip.')),
  A('OpenJS.NodeJS.LTS', 'Node.js LTS', 'OpenJS Foundation', 'dev', t('JavaScript outside the browser, long-term support.')),
  A('Microsoft.WindowsTerminal', 'Windows Terminal', 'Microsoft', 'dev', t('Modern terminal with tabs.'), 'https://i.ibb.co/TBjm1bMR/terminal.png'),
  A('Microsoft.PowerShell', 'PowerShell 7', 'Microsoft', 'dev', t('The newest cross-platform PowerShell.'), 'https://github.com/PowerShell.png?size=128'),
  A('Notepad++.Notepad++', 'Notepad++', 'Notepad++ Team', 'dev', t('Light text and code editor.')),
  A('VSCodium.VSCodium', 'VSCodium', 'VSCodium', 'dev', t('VS Code without Microsoft telemetry.')),
  A('Anysphere.Cursor', 'Cursor', 'Anysphere', 'dev', t('Code editor built around AI.')),
  A('JetBrains.Toolbox', 'JetBrains Toolbox', 'JetBrains', 'dev', t('Install and update JetBrains IDEs.')),
  A('Microsoft.VisualStudio.2022.Community', 'Visual Studio Community 2022', 'Microsoft', 'dev', t('Full IDE for .NET and C++.'), 'https://raw.githubusercontent.com/jberezanski/ChocolateyPackages/master/icons/vs2022.png'),
  A('Google.AndroidStudio', 'Android Studio', 'Google', 'dev', t('Build Android apps.')),
  A('Docker.DockerDesktop', 'Docker Desktop', 'Docker', 'dev', t('Containers on your PC.')),
  A('Postman.Postman', 'Postman', 'Postman', 'dev', t('Build and test APIs.')),
  A('DBeaver.DBeaver.Community', 'DBeaver', 'DBeaver', 'dev', t('Universal database tool.')),
  A('PuTTY.PuTTY', 'PuTTY', 'Simon Tatham', 'dev', t('SSH and Telnet client.')),
  A('WinSCP.WinSCP', 'WinSCP', 'Martin Prikryl', 'dev', t('Copy files over SFTP and FTP.')),
  A('Oracle.VirtualBox', 'VirtualBox', 'Oracle', 'dev', t('Run other operating systems in a virtual machine.')),
  A('Rustlang.Rustup', 'Rustup', 'The Rust Project', 'dev', t('Install and manage Rust.')),
  A('GoLang.Go', 'Go', 'Google', 'dev', t('The Go programming language.')),
  A('astral-sh.uv', 'uv', 'Astral', 'dev', t('Extremely fast Python package manager.')),
  A('GodotEngine.GodotEngine', 'Godot Engine', 'Godot Foundation', 'dev', t('Free, open-source game engine.')),
  /* productivity */
  A('TheDocumentFoundation.LibreOffice', 'LibreOffice', 'The Document Foundation', 'productivity', t('Free office suite compatible with Microsoft Office.')),
  A('ONLYOFFICE.DesktopEditors', 'ONLYOFFICE', 'Ascensio System', 'productivity', t('Documents, spreadsheets and slides.')),
  A('Obsidian.Obsidian', 'Obsidian', 'Obsidian', 'productivity', t('Linked notes stored as files on your PC.')),
  A('Notion.Notion', 'Notion', 'Notion Labs', 'productivity', t('Notes, docs and projects in one workspace.')),
  A('Joplin.Joplin', 'Joplin', 'Laurent Cozic', 'productivity', t('Open-source notes with sync.')),
  A('Logseq.Logseq', 'Logseq', 'Logseq', 'productivity', t('Outliner for notes and knowledge.')),
  A('Adobe.Acrobat.Reader.64-bit', 'Adobe Acrobat Reader', 'Adobe', 'productivity', t('Read, sign and comment on PDFs.'), 'https://i.postimg.cc/wvbKJzmr/acrobat.png'),
  A('SumatraPDF.SumatraPDF', 'SumatraPDF', 'Krzysztof Kowalczyk', 'productivity', t('Tiny, fast PDF and ebook reader.'), 'https://github.com/sumatrapdfreader.png?size=128'),
  A('geeksoftwareGmbH.PDF24Creator', 'PDF24 Creator', 'geek software', 'productivity', t('Merge, split, compress and convert PDFs.')),
  A('DigitalScholar.Zotero', 'Zotero', 'Digital Scholar', 'productivity', t('Collect and cite your sources.')),
  A('Anki.Anki', 'Anki', 'Ankitects', 'productivity', t('Flashcards that help you remember.')),
  A('calibre.calibre', 'calibre', 'Kovid Goyal', 'productivity', t('Manage and convert ebooks.')),
  A('Doist.Todoist', 'Todoist', 'Doist', 'productivity', t('Tasks and to-do lists.')),
  A('Google.GoogleDrive', 'Google Drive', 'Google', 'productivity', t('Your Google Drive files on the PC.')),
  A('Dropbox.Dropbox', 'Dropbox', 'Dropbox', 'productivity', t('Sync and share files.')),
  A('Microsoft.OneDrive', 'OneDrive', 'Microsoft', 'productivity', t("Microsoft's cloud storage."), 'https://github.com/OneDrive.png?size=128'),
  /* utilities */
  A('7zip.7zip', '7-Zip', 'Igor Pavlov', 'utilities', t('Open and create ZIP, 7z, RAR and more.')),
  A('RARLab.WinRAR', 'WinRAR', 'RARLab', 'utilities', t('The classic RAR and ZIP archiver.')),
  A('Giorgiotani.Peazip', 'PeaZip', 'Giorgio Tani', 'utilities', t('Archiver for more than 200 formats.')),
  A('voidtools.Everything', 'Everything', 'voidtools', 'utilities', t('Find any file by name, instantly.')),
  A('Microsoft.PowerToys', 'PowerToys', 'Microsoft', 'utilities', t('Power-user tools for Windows.'), 'https://i.postimg.cc/DfmW7XGy/pticon.png'),
  A('ShareX.ShareX', 'ShareX', 'ShareX Team', 'utilities', t('Screenshots, recordings and quick uploads.')),
  A('Greenshot.Greenshot', 'Greenshot', 'Greenshot', 'utilities', t('Light screenshot tool.')),
  A('AntibodySoftware.WizTree', 'WizTree', 'Antibody Software', 'utilities', t('See what fills your disk, very fast.')),
  A('CPUID.CPU-Z', 'CPU-Z', 'CPUID', 'utilities', t('Details of your processor, board and memory.')),
  A('TechPowerUp.GPU-Z', 'GPU-Z', 'TechPowerUp', 'utilities', t('Details of your graphics card.')),
  A('REALiX.HWiNFO', 'HWiNFO', 'REALiX', 'utilities', t('Detailed hardware info and sensors.'), 'https://i.postimg.cc/MKfynM2J/HWiNFO64.png'),
  A('CrystalDewWorld.CrystalDiskInfo', 'CrystalDiskInfo', 'Crystal Dew World', 'utilities', t('Disk health from its SMART data.')),
  A('CrystalDewWorld.CrystalDiskMark', 'CrystalDiskMark', 'Crystal Dew World', 'utilities', t('Measure how fast your disk is.')),
  A('Rufus.Rufus', 'Rufus', 'Pete Batard', 'utilities', t('Make bootable USB drives.')),
  A('qBittorrent.qBittorrent', 'qBittorrent', 'qBittorrent', 'utilities', t('Open-source torrent client without ads.')),
  A('AnyDesk.AnyDesk', 'AnyDesk', 'AnyDesk Software', 'utilities', t('Remote desktop access.'), 'https://img.icons8.com/fluency/512/anydesk.png'),
  A('TeamViewer.TeamViewer', 'TeamViewer', 'TeamViewer', 'utilities', t('Remote support and access.')),
  A('LocalSend.LocalSend', 'LocalSend', 'LocalSend', 'utilities', t('Send files to nearby devices, no cloud.')),
  A('Flow-Launcher.Flow-Launcher', 'Flow Launcher', 'Flow Launcher', 'utilities', t('Launch apps and search with a shortcut.'), 'https://github.com/Flow-Launcher.png?size=128'),
  A('File-New-Project.EarTrumpet', 'EarTrumpet', 'File-New-Project', 'utilities', t('Volume control for each app.'), 'https://raw.githubusercontent.com/File-New-Project/EarTrumpet/master/EarTrumpet/Assets/Logo-Light.png'),
  A('Klocman.BulkCrapUninstaller', 'Bulk Crap Uninstaller', 'Marcin Szeniak', 'utilities', t('Remove many programs at once.')),
  A('Microsoft.Sysinternals.ProcessExplorer', 'Process Explorer', 'Sysinternals', 'utilities', t('Task Manager on steroids.'), 'https://learn.microsoft.com/en-us/sysinternals/media/index/sysinternals.png'),
  A('AutoHotkey.AutoHotkey', 'AutoHotkey', 'AutoHotkey', 'utilities', t('Automate keys and tasks with scripts.'), 'https://github.com/AutoHotkey.png?size=128'),
  A('FilesCommunity.Files', 'Files', 'Files Community', 'utilities', t('Modern file manager with tabs.'), 'https://github.com/files-community.png?size=128'),
  A('RamenSoftware.Windhawk', 'Windhawk', 'Ramen Software', 'utilities', t('Customize Windows with small mods.')),
  A('Balena.Etcher', 'balenaEtcher', 'Balena', 'utilities', t('Flash OS images to USB drives and SD cards.')),
  /* security */
  A('Bitwarden.Bitwarden', 'Bitwarden', 'Bitwarden', 'security', t('Open-source password manager.')),
  A('KeePassXCTeam.KeePassXC', 'KeePassXC', 'KeePassXC Team', 'security', t('Offline password manager.')),
  A('AgileBits.1Password', '1Password', 'AgileBits', 'security', t('Password manager for families and teams.')),
  A('Proton.ProtonPass', 'Proton Pass', 'Proton', 'security', t('Encrypted passwords and email aliases.')),
  A('Malwarebytes.Malwarebytes', 'Malwarebytes', 'Malwarebytes', 'security', t('Malware scanner and removal.')),
  A('Proton.ProtonVPN', 'Proton VPN', 'Proton', 'security', t('Swiss VPN with a free plan.')),
  A('MullvadVPN.MullvadVPN', 'Mullvad VPN', 'Mullvad', 'security', t('Anonymous VPN, no account details.')),
  A('NordSecurity.NordVPN', 'NordVPN', 'Nord Security', 'security', t('Popular VPN service.'), 'https://community.chocolatey.org/content/packageimages/nordvpn.6.40.5.png'),
  A('WireGuard.WireGuard', 'WireGuard', 'WireGuard', 'security', t('Fast, modern VPN tunnel.')),
  A('Tailscale.Tailscale', 'Tailscale', 'Tailscale', 'security', t('Private network between your devices.')),
  A('IDRIX.VeraCrypt', 'VeraCrypt', 'IDRIX', 'security', t('Encrypt disks and file containers.'), 'https://github.com/veracrypt.png?size=128'),
  A('Cryptomator.Cryptomator', 'Cryptomator', 'Skymatic', 'security', t('Encrypt your cloud files.')),
  A('OO-Software.ShutUp10', 'O&O ShutUp10++', 'O&O Software', 'security', t('Turn off Windows telemetry.')),
  A('Safing.Portmaster', 'Portmaster', 'Safing', 'security', t("See and block your apps' connections.")),
  /* runtimes */
  A('Microsoft.VCRedist.2015+.x64', 'Visual C++ 2015-2022 (x64)', 'Microsoft', 'runtimes', t('Needed by most games and apps.'), 'https://i.postimg.cc/rwGzh5vf/Visual-Studio-Icon-2022.png'),
  A('Microsoft.VCRedist.2015+.x86', 'Visual C++ 2015-2022 (x86)', 'Microsoft', 'runtimes', t('The 32-bit version, for older apps.'), 'https://i.postimg.cc/rwGzh5vf/Visual-Studio-Icon-2022.png'),
  A('Microsoft.DotNet.DesktopRuntime.8', '.NET Desktop Runtime 8', 'Microsoft', 'runtimes', t('Runs .NET 8 desktop apps.')),
  A('Microsoft.DotNet.DesktopRuntime.9', '.NET Desktop Runtime 9', 'Microsoft', 'runtimes', t('Runs .NET 9 desktop apps.')),
  A('Microsoft.DotNet.DesktopRuntime.10', '.NET Desktop Runtime 10', 'Microsoft', 'runtimes', t('Runs .NET 10 desktop apps.')),
  A('Microsoft.DirectX', 'DirectX End-User Runtime', 'Microsoft', 'runtimes', t('Older DirectX pieces some games need.')),
  A('Microsoft.EdgeWebView2Runtime', 'WebView2 Runtime', 'Microsoft', 'runtimes', t('Web engine many modern apps use.'), 'https://github.com/MicrosoftEdge.png?size=128'),
  A('EclipseAdoptium.Temurin.21.JRE', 'Java 21 (Temurin)', 'Eclipse Adoptium', 'runtimes', t('Free Java runtime for apps and Minecraft mods.')),
  A('Oracle.JavaRuntimeEnvironment', 'Java 8 (Oracle)', 'Oracle', 'runtimes', t('The classic Java for older programs.'), 'https://cdn-icons-png.flaticon.com/256/226/226777.png'),
  A('Microsoft.XNARedist', 'XNA Framework 4.0', 'Microsoft', 'runtimes', t('Needed by some older indie games.'), 'https://community.chocolatey.org/content/packageimages/xna31.3.1.0.20160105.png'),
  A('CreativeTechnology.OpenAL', 'OpenAL', 'Creative Labs', 'runtimes', t('3D audio library some games use.')),
  A('Microsoft.DotNet.AspNetCore.8', 'ASP.NET Core Runtime 8', 'Microsoft', 'runtimes', t('Runs ASP.NET Core 8 apps and services.')),
];
const BY = {};
CATALOG.forEach((a, i) => { if (a) { a.n = i; BY[a.id] = a; } });
const APPS = CATALOG.filter(Boolean);

/* ---------------- ready-made kits ---------------- */
const KITS = [
  { id: 'essentials', n: t('Essentials'), d: t('The apps almost every PC needs.'), ic: 'sparkle', c: 'var(--accent)',
    apps: ['Google.Chrome', '7zip.7zip', 'VideoLAN.VLC', 'voidtools.Everything', 'ShareX.ShareX', 'SumatraPDF.SumatraPDF', 'TheDocumentFoundation.LibreOffice', 'Microsoft.VCRedist.2015+.x64', 'Microsoft.DotNet.DesktopRuntime.8'] },
  { id: 'fresh', n: t('Fresh Windows'), d: t('Tools and runtimes worth having on a clean install.'), ic: 'windows', c: 'var(--accent2)',
    apps: ['Microsoft.PowerToys', '7zip.7zip', 'voidtools.Everything', 'File-New-Project.EarTrumpet', 'Microsoft.WindowsTerminal', 'OO-Software.ShutUp10', 'Klocman.BulkCrapUninstaller', 'Microsoft.VCRedist.2015+.x64', 'Microsoft.VCRedist.2015+.x86', 'Microsoft.DotNet.DesktopRuntime.8', 'Microsoft.EdgeWebView2Runtime'] },
  { id: 'gamer', n: t('Gamer'), d: t('Every launcher, voice chat and the runtimes games need.'), ic: 'hg-pad', c: '#FF8FB1',
    apps: ['Valve.Steam', 'EpicGames.EpicGamesLauncher', 'GOG.Galaxy', '9MV0B5HZVK9Z', 'Discord.Discord', 'Playnite.Playnite', 'Guru3D.Afterburner', 'Microsoft.DirectX', 'Microsoft.VCRedist.2015+.x64', 'Microsoft.VCRedist.2015+.x86', 'Microsoft.DotNet.DesktopRuntime.8'] },
  { id: 'dev', n: t('Developer'), d: t('Editor, Git, terminals, languages and containers.'), ic: 'code', c: 'var(--ok)',
    apps: ['Microsoft.VisualStudioCode', 'Git.Git', 'GitHub.GitHubDesktop', 'GitHub.cli', 'Microsoft.WindowsTerminal', 'Microsoft.PowerShell', 'Python.Python.3.13', 'OpenJS.NodeJS.LTS', 'astral-sh.uv', 'Docker.DockerDesktop', 'Postman.Postman', 'Notepad++.Notepad++'] },
  { id: 'creator', n: t('Creator'), d: t('Edit photos, video, audio and 3D, and stream.'), ic: 'palette', c: '#FFB27A',
    apps: ['OBSProject.OBSStudio', 'GIMP.GIMP.3', 'KDE.Krita', 'Inkscape.Inkscape', 'BlenderFoundation.Blender', 'Meltytech.Shotcut', 'Audacity.Audacity', 'HandBrake.HandBrake', 'dotPDN.PaintDotNet'] },
  { id: 'student', n: t('Student'), d: t('Office, notes, references and video classes.'), ic: 'hg-cap', c: '#F4C26B',
    apps: ['TheDocumentFoundation.LibreOffice', 'DigitalScholar.Zotero', 'Anki.Anki', 'Obsidian.Obsidian', 'SumatraPDF.SumatraPDF', 'Zoom.Zoom', 'Google.GoogleDrive', 'Mozilla.Firefox'] },
  { id: 'remote', n: t('Remote work'), d: t('Meetings, chat, shared files and remote access.'), ic: 'hg-brief', c: '#8EA2FF',
    apps: ['Zoom.Zoom', 'Microsoft.Teams', 'SlackTechnologies.Slack', 'Notion.Notion', 'Dropbox.Dropbox', 'AnyDesk.AnyDesk', 'Bitwarden.Bitwarden', 'Mozilla.Thunderbird'] },
  { id: 'privacy', n: t('Privacy first'), d: t('A private browser, passwords, VPN and encryption.'), ic: 'lock', c: '#5FD3C6',
    apps: ['Brave.Brave', 'Bitwarden.Bitwarden', 'Proton.ProtonVPN', 'OpenWhisperSystems.Signal', 'IDRIX.VeraCrypt', 'Cryptomator.Cryptomator', 'OO-Software.ShutUp10', 'Safing.Portmaster'] },
];

/* ---------------- sample data (only outside the app) ---------------- */
const MOCK_INSTALLED = ['Google.Chrome', '7zip.7zip', 'Discord.Discord', 'Valve.Steam', 'Microsoft.Edge', 'Microsoft.VCRedist.2015+.x64', 'Microsoft.EdgeWebView2Runtime',
  'Microsoft.OneDrive', 'Microsoft.Teams', 'Spotify.Spotify', 'Microsoft.WindowsTerminal', 'Microsoft.DotNet.DesktopRuntime.8', 'Git.Git', 'Microsoft.VisualStudioCode', 'Python.Python.3.13'];
const MOCK_SEL = ['Mozilla.Firefox', 'VideoLAN.VLC', 'OBSProject.OBSStudio', 'Bitwarden.Bitwarden', 'Microsoft.PowerToys', 'voidtools.Everything', 'ShareX.ShareX', 'Notepad++.Notepad++'];
const MOCK_FAIL = { 'Ubisoft.Connect': t('The program is open: close it and try again.'), 'TeamViewer.TeamViewer': t('Another installation is running. Try again when it finishes.') };
const MOCK_SEARCH = [['Mozilla.Firefox.ESR', 'Firefox ESR', '140.5.0'], ['Google.Chrome.Beta', 'Google Chrome Beta', '143.0.7499.4'], ['Rainmeter.Rainmeter', 'Rainmeter', '4.5.23'],
  ['flux.flux', 'f.lux', '4.134'], ['rocksdanister.LivelyWallpaper', 'Lively Wallpaper', '2.1.0.8'], ['Krisp.Krisp', 'Krisp', '2.58.4'], ['Audacious.Audacious', 'Audacious', '4.5.1'],
  ['Hugo.Hugo.Extended', 'Hugo (extended)', '0.152.2'], ['JGraph.Draw', 'draw.io', '28.2.5'], ['9NBLGGH4NNS1', 'App Installer', '1.29.380'], ['Microsoft.Office', 'Microsoft 365 Apps', '16.0.19127'],
  ['OpenWhisperSystems.Signal.Beta', 'Signal Beta', '7.79.0-beta.1'], ['Spotify.Spotify.Beta', 'Spotify (beta)', ''], ['Nilesoft.Shell', 'Nilesoft Shell', '1.9.18'], ['Lexikos.AutoHotkey.Dash', 'AutoHotkey Dash', '2.0.19']]
  .map(([id, name, version]) => ({ id, name, version, source: STORE_RE.test(id) ? 'msstore' : 'winget' }));
const MOCK_HIST = () => {
  const now = Date.now() / 1000, mk = (ids, fail = {}, skip = []) => ids.map(id => ({ id, name: (BY[id] || {}).name || id, st: fail[id] ? 'fail' : skip.includes(id) ? 'skip' : 'done', msg: fail[id] ? MOCK_FAIL[id] || fail[id] : skip.includes(id) ? t('Already installed') : null }));
  return [
    { run: 'm1', at: now - 3600 * 26, scope: '', items: mk(['Mozilla.Firefox', 'VideoLAN.VLC', 'OBSProject.OBSStudio', 'Audacity.Audacity', 'HandBrake.HandBrake', 'Google.Chrome'], { 'TeamViewer.TeamViewer': 1 }, ['Google.Chrome']).concat(mk(['TeamViewer.TeamViewer'], { 'TeamViewer.TeamViewer': 1 })) },
    { run: 'm2', at: now - 86400 * 6, scope: 'machine', items: mk(['Valve.Steam', 'EpicGames.EpicGamesLauncher', 'Discord.Discord', 'Microsoft.DirectX', 'Microsoft.VCRedist.2015+.x86']) },
    { run: 'm3', at: now - 86400 * 21, scope: 'user', items: mk(['Microsoft.VisualStudioCode', 'Git.Git', 'Python.Python.3.13', 'OpenJS.NodeJS.LTS']) },
  ];
};

/* ---------------- state ---------------- */
const S = {
  sel: new Map(),        // id -> app (from the catalog or a winget search)
  inst: new Set(),       // installed ids
  instTs: 0, scanning: false, scanned: false, scanErr: null, winget: true, dry: false,
  icons: {},             // id -> data URI
  q: '', cat: 'all', filter: 'all',
  ws: { q: '', items: null, busy: false, err: null, job: null, more: 0 }, // winget search
  hist: null, histErr: null, restored: false,
};
let ctxRef = null;
const opts = () => ({ scope: '', skip: true, ...(state.settings.hangarOpts || {}) });
const setOpt = (k, v) => SH.setSetting('hangarOpts', { ...opts(), [k]: v });
const userKits = () => (state.settings.hangarKits || []).filter(k => k && Array.isArray(k.apps));
const saveKits = list => { state.settings.hangarKits = undefined; SH.setSetting('hangarKits', list); };
let selTimer = 0;
const persistSel = () => { clearTimeout(selTimer); selTimer = setTimeout(() => { state.settings.hangarSel = undefined; SH.setSetting('hangarSel', [...S.sel.values()].map(a => ({ id: a.id, name: a.name, source: a.source, pub: a.pub || '' }))); }, 400); };
function restoreSel() {
  if (S.restored) return; S.restored = true;
  const saved = state.settings.hangarSel;
  const list = Array.isArray(saved) ? saved : REAL ? [] : MOCK_SEL.map(id => ({ id }));
  list.forEach(x => { if (!x || !ID_RE.test(x.id || '')) return; S.sel.set(x.id, BY[x.id] || { id: x.id, name: x.name || x.id, pub: x.pub || '', source: x.source || (STORE_RE.test(x.id) ? 'msstore' : 'winget') }); });
}
const appOf = x => BY[x.id] || { id: x.id, name: x.name || x.id, pub: x.pub || '', source: x.source || (STORE_RE.test(x.id) ? 'msstore' : 'winget') };
const plain = a => ({ id: a.id, name: a.name, source: a.source || 'winget' });
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nApps = n => n === 1 ? t('1 app') : t('{n} apps', { n: SH.fmtInt(n) });

/* ---------------- icons ---------------- */
const PAL = ['#6FA8FF', '#8EA2FF', '#7FE0B4', '#FFB27A', '#F4C26B', '#A8D672', '#FF8FB1', '#5FD3C6', '#C9D4E8'];
const colorFor = s => PAL[[...String(s)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % PAL.length];
const initial = s => (String(s).replace(/^[^A-Za-z0-9]+/, '')[0] || '?').toUpperCase();
/* outside the app (design previews only) the icons load straight from the web; inside, they come cached from the engine */
const remoteIcon = a => a.icon || (STORE_RE.test(a.id) ? '' : `https://api.winstall.app/icons/next/${encodeURIComponent(a.id)}.webp`);
function iconSrc(a) { return S.icons[a.id] || (!REAL && BY[a.id] ? remoteIcon(a) : ''); }
function letter(a) { return a.cat === 'runtimes' ? `<i class="hg-lt" style="--c:var(--accent2)">${ic('layers')}</i>` : `<i class="hg-lt" style="--c:${colorFor(a.name)}">${esc(initial(a.name))}</i>`; }
function icon(a, cls = '') {
  const src = iconSrc(a);
  return `<span class="hg-ic ${cls}" data-ic="${esc(a.id)}">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">` : letter(a)}</span>`;
}
/* broken remote images (sample mode) fall back to the letter */
document.addEventListener('error', e => { const im = e.target; if (im.tagName !== 'IMG') return; const box = im.closest && im.closest(`#v-${ID} .hg-ic`); if (!box) return;
  const a = BY[box.dataset.ic] || { name: box.dataset.ic }; box.innerHTML = letter(a); }, true);
function applyIcons(map) {
  const fresh = Object.entries(map || {}).filter(([id, u]) => u && S.icons[id] !== u);
  if (!fresh.length) return;
  fresh.forEach(([id, u]) => { S.icons[id] = u; });
  /* one pass over the page (not one query per icon) and all the writes before the visibility reads: no layout thrash */
  const boxes = new Map();
  $$(`#v-${ID} .hg-ic[data-ic]`).forEach(b => { const k = b.dataset.ic; (boxes.get(k) || boxes.set(k, []).get(k)).push(b); });
  const done = [];
  fresh.forEach(([id, u]) => (boxes.get(id) || []).forEach(box => { box.innerHTML = `<img src="${esc(u)}" alt="" loading="lazy" decoding="async">`; done.push(box); }));
  let n = 0;
  for (const box of done) {
    if (n >= 24) break;  /* only the first screenful pops in, the rest simply appear */
    if (box.offsetParent) { n++; anim(box.firstChild, [{ opacity: 0, transform: 'scale(.6)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 380, e: EASE.spring }); }
  }
}
const iconReq = new Set();
async function loadIcons(list) {
  if (!REAL) return;
  const want = list.filter(a => a && !S.icons[a.id] && !iconReq.has(a.id)); if (!want.length) return;
  want.forEach(a => iconReq.add(a.id));
  let have = {}; try { have = await SH.engine(ID, 'icons_cached', want.map(a => a.id)) || {}; } catch { have = {}; }
  applyIcons(have);
  const miss = want.filter(a => !have[a.id]); if (!miss.length) return;
  SH.job(ID, 'fetch_icons', [miss.map(a => ({ id: a.id, name: a.name, icon: a.icon || '' }))], { onProgress: m => { if (m.data && m.data.icons) applyIcons(m.data.icons); } })
    .then(r => r && applyIcons(r.icons)).catch(() => {});
}

/* ---------------- what is installed ---------------- */
let pInst = null;
function applyInstalled(r) {
  if (!r) return;
  S.inst = new Set(r.installed || []); S.instTs = (r.ts || 0) * 1000; S.scanned = true;
  if (r.winget === false) S.winget = false;
  refreshInstalledMarks();
}
/* how: undefined (opening the module: followed from anywhere once it runs for a moment), 'user' (Check again: at once;
   S.scanTold says the toast with View already told how it went) or 'quiet' (the refresh after installing) */
function scanInstalled(force, how) {
  if (pInst && !force) return pInst;
  S.scanning = true; S.scanErr = null; S.scanTold = false; updScan();
  const act = how === 'quiet' ? null : SH.activity.start(ID, { key: 'scan', label: t("Checking what's installed…"), bg: how !== 'user' });
  pInst = (REAL ? SH.job(ID, 'scan_installed', [APPS.map(a => [a.id, a.name])]) : wait(900).then(() => ({ installed: MOCK_INSTALLED, ts: Date.now() / 1000 })))
    .then(r => { S.scanning = false; applyInstalled(r); updScan();
      if (act) S.scanTold = act.end({ ok: true, summary: t('{n} apps from the catalog are installed.', { n: APPS.filter(a => S.inst.has(a.id)).length }) }); return r; })
    .catch(e => { S.scanning = false; S.scanErr = e.message; updScan(); if (act) S.scanTold = act.end(e.cancelled ? { cancelled: true } : { ok: false, error: e.message }); });
  return pInst;
}
let booted = false;
async function boot() {
  if (booted) return; booted = true;
  if (!REAL) { scanInstalled(); return; }
  let c = null; try { c = await SH.engine(ID, 'cached'); } catch { c = null; }
  if (c && c.status) { S.winget = c.status.winget !== false; S.dry = !!c.status.dry; }
  if (c && c.installed) applyInstalled(c.installed);
  if (!S.winget) { updScan(); rerenderCatalog(); return; }
  if (!c || !c.installed || Date.now() - S.instTs > 10 * 60e3) scanInstalled(); else updScan();
  loadIcons(APPS);
}
function updScan() {
  $$(`#v-${ID} .hg-scan`).forEach(el => {
    const txt = !S.winget ? '' : S.scanning ? t("Checking what's installed…") : S.scanErr ? t("Couldn't check what's installed.") : S.scanned ? t('{n} of these are installed', { n: SH.fmtInt(APPS.filter(a => S.inst.has(a.id)).length) }) : '';
    el.classList.toggle('busy', S.scanning); el.classList.toggle('err', !!S.scanErr);
    const s = $('span:last-child', el); if (s.textContent !== txt) { s.textContent = txt; anim(el, [{ opacity: 0, transform: 'translate3d(0,4px,0)' }, { opacity: 1, transform: 'none' }], { d: 300 }); }
  });
  const rb = $(`#v-${ID} [data-rescan]`); if (rb) rb.disabled = S.scanning;
}
function refreshInstalledMarks() {
  $$(`#v-${ID} .hg-app[data-app]`).forEach(b => { const on = S.inst.has(b.dataset.app); if (b.classList.contains('is-inst') !== on) { b.classList.toggle('is-inst', on); const s = $('.hg-at>span', b); if (s) s.innerHTML = subLine(BY[b.dataset.app]); } });
  const v = $(`#v-${ID} .tab[data-tab="catalog"]`); if (v && S.filter === 'new') renderList(false);
  updSide(); updSecCounts(); updScan();
  const k = $(`#v-${ID} .tab[data-tab="kits"]`); if (k && k.dataset.ready) fillKits(k);
}

/* ---------------- selection ---------------- */
function toggleSel(a, on, quiet) {
  const has = S.sel.has(a.id); if (on === undefined) on = !has; if (on === has) return false;
  if (on) S.sel.set(a.id, a); else S.sel.delete(a.id);
  $$(`#v-${ID} [data-app="${CSS.escape(a.id)}"], #v-${ID} [data-w="${CSS.escape(a.id)}"]`).forEach(b => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); const ck = $('.check', b); if (ck) ck.classList.toggle('on', on); });
  if (!quiet) { sideRow(a, on); afterSel(); }
  return true;
}
function setMany(list, on) {
  let n = 0; list.forEach(a => { if (toggleSel(a, on, true)) n++; });
  if (n) { fillSideList(true); afterSel(); }
  return n;
}
function afterSel() { persistSel(); updSide(); updSecCounts(); updHeader(); if (ctxRef) ctxRef.setBadge('catalog', S.sel.size); if (S.filter === 'sel') renderList(false); }
function toInstall() { const o = opts(); return [...S.sel.values()].filter(a => !(o.skip && S.inst.has(a.id))); }

/* ---------------- Catalog ---------------- */
function renderCatalog(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="hg-cat">
    <div class="pan hg-main" data-asm>
      <div class="hg-tools">
        <label class="field hg-search">${ic('search')}<input placeholder="${esc(t('Search apps, or anything on winget'))}" spellcheck="false"><button class="hg-x" data-qx aria-label="${esc(t('Clear the search'))}" hidden>${ic('x')}</button></label>
        <div class="seg hg-filt"><span class="ind"></span><button data-f="all" class="on">${t('All')}</button><button data-f="new">${t('Not installed')}</button><button data-f="sel">${t('Selected')}</button></div>
        <span class="sp"></span><span class="hg-scan faint"><span class="hg-spin"></span><span></span></span>
      </div>
      <div class="hg-nowg"></div>
      <div class="hg-body">
        <nav class="hg-rail">${railHTML()}</nav>
        <div class="hg-scroll"><div class="hg-list">${skelList()}</div></div>
      </div>
    </div>
    <aside class="pan hg-side" data-asm>${sideHTML()}</aside>
  </div>`;
  requestAnimationFrame(() => { SH.placeSeg($('.hg-filt', el), true); placeScope(el, true); });
  restoreSel();
  /* tiles a frame later: the skeleton paints at once even on a slow PC */
  setTimeout(() => { renderList(true); fillSideList(false); updSide(); updScan(); updHeader(); if (ctxRef) ctxRef.setBadge('catalog', S.sel.size); noWinget(el); });
  const inp = $('.hg-search input', el);
  let deb = 0;
  inp.addEventListener('input', () => {
    S.q = inp.value.trim(); $('[data-qx]', el).hidden = !S.q; renderList(true);
    clearTimeout(deb); deb = setTimeout(() => wingetSearch(S.q), 650);
  });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(deb); wingetSearch(S.q, true); } if (e.key === 'Escape' && inp.value) { e.stopPropagation(); clearQuery(el); } });
  el.addEventListener('click', e => catalogClick(e, el));
}
function clearQuery(el) { const inp = $('.hg-search input', el); inp.value = ''; S.q = ''; $('[data-qx]', el).hidden = true; if (S.ws.job) S.ws.job.cancel(); S.ws = { q: '', items: null, busy: false, err: null, job: null, more: 0 }; renderList(true); inp.focus(); }
function noWinget(el) {
  const box = $('.hg-nowg', el); if (!box) return;
  box.innerHTML = S.winget ? '' : `<div class="hg-warn">${ic('alert')}<span>${t("winget isn't available on this PC, so App Hangar can't install apps. Install or update App Installer from the Microsoft Store, then come back.")}</span><button class="btn sm sec" data-url="https://apps.microsoft.com/detail/9nblggh4nns1">${ic('external')}${t('Open the Store')}</button></div>`;
}
function railHTML() {
  const cnt = c => APPS.filter(a => a.cat === c).length;
  return [`<button class="hg-rb${S.cat === 'all' ? ' on' : ''}" data-cat="all">${ic('grid')}<span>${t('All apps')}</span><em data-rc="all">${SH.fmtInt(APPS.length)}</em></button>`,
    ...CATS.map(c => `<button class="hg-rb${S.cat === c.id ? ' on' : ''}" data-cat="${c.id}">${ic(c.ic)}<span>${esc(c.n)}</span><em data-rc="${c.id}">${SH.fmtInt(cnt(c.id))}</em></button>`)].join('');
}
function skelList() {
  return [0, 1].map(k => `<section class="hg-sec"><div class="hg-sh"><span class="sk" style="width:30px;height:30px;border-radius:9px"></span><span class="sk" style="width:${130 + k * 40}px;height:12px"></span></div>
    <div class="hg-grid">${Array.from({ length: 9 }, (_, i) => `<div class="hg-app sk-app"><span class="sk" style="width:36px;height:36px;border-radius:var(--r-s);--dl:${i * .05}s"></span><span class="hg-at"><span class="sk" style="height:11px;width:${50 + (i * 17) % 35}%;--dl:${i * .05}s"></span><span class="sk" style="height:9px;width:${65 + (i * 13) % 25}%;margin-top:8px;--dl:${i * .05}s"></span></span></div>`).join('')}</div></section>`).join('');
}
function matchQ(a, q) { const f = fold(q); return fold(`${a.name} ${a.pub} ${a.id} ${a.desc}`).includes(f); }
function visible(cat) {
  let list = APPS.filter(a => a.cat === cat);
  if (S.filter === 'new') list = list.filter(a => !S.inst.has(a.id));
  if (S.filter === 'sel') list = list.filter(a => S.sel.has(a.id));
  if (S.q) list = list.filter(a => matchQ(a, S.q));
  return list;
}
function subLine(a) { return S.inst.has(a.id) ? `<i class="hg-ok">${ic('check')}${t('Installed')}</i>` : esc(a.desc); }
function tileHTML(a) {
  const on = S.sel.has(a.id), inst = S.inst.has(a.id);
  return `<button class="hg-app${on ? ' on' : ''}${inst ? ' is-inst' : ''}" data-app="${esc(a.id)}" aria-pressed="${on}" title="${esc(`${a.name} (${a.pub})\n${a.desc}`)}">
    ${icon(a)}<span class="hg-at"><b>${esc(a.name)}</b><span>${subLine(a)}</span></span><span class="check${on ? ' on' : ''}">${ic('check')}</span></button>`;
}
function secHTML(c, list) {
  return `<section class="hg-sec" data-sec="${c.id}"><div class="hg-sh"><span class="hg-si">${ic(c.ic)}</span><b>${esc(c.n)}</b><span class="faint hg-sc" data-sc="${c.id}"></span><span class="sp"></span>
    <button class="btn sm ghost hg-sall" data-all="${c.id}"></button></div><div class="hg-grid">${list.map(tileHTML).join('')}</div></section>`;
}
let listJob = 0;
function renderList(animate) {
  const el = $(`#v-${ID} .tab[data-tab="catalog"]`); if (!el) return; const box = $('.hg-list', el); if (!box) return;
  const cats = S.cat === 'all' ? CATS : [CAT[S.cat]];
  const parts = cats.map(c => [c, visible(c.id)]).filter(([, l]) => l.length);
  /* A fresh list (first visit, a filter or a search, which also puts the scroll back on top) paints the sections that fill the screen
     at once and adds the rest in idle time: ~150 tiles in one go were a 60-130 ms freeze. A refresh that must keep the scroll
     position (animate false) is built whole. */
  const job = ++listJob, head = animate ? parts.slice(0, 3) : parts, rest = animate ? parts.slice(3) : [];
  let html = head.map(([c, l]) => secHTML(c, l)).join('');
  if (!parts.length) html = SH.emptyState({ cls: 'hg-empty', art: S.q ? 'none' : S.filter === 'new' ? 'ok' : 'first', title: S.q ? t('Nothing in the catalog matches “{q}”', { q: esc(S.q) }) : S.filter === 'sel' ? t('Nothing selected yet') : S.filter === 'new' ? t('You already have all of these') : t('No apps here'), text: S.q ? t('Look below for results from winget.') : S.filter === 'sel' ? t('Tick the apps you want, or start from a kit.') : '' });
  if (S.q.length >= 2 && !rest.length) html += wingetSecHTML();
  box.innerHTML = html;
  updSecCounts();
  /* the rail counts what the search and the filter leave */
  let tot = 0; CATS.forEach(c => { const n = visible(c.id).length; tot += n; const x = $(`[data-rc="${c.id}"]`, el); if (x) { x.textContent = SH.fmtInt(n); x.closest('.hg-rb').classList.toggle('none', !n); } });
  const ta = $('[data-rc="all"]', el); if (ta) ta.textContent = SH.fmtInt(tot);
  if (animate) $$('.hg-sh, .hg-app, .hg-empty, .hg-wrow', box).slice(0, 30).forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(0,10px,0)' }, { opacity: 1, transform: 'none' }], { d: 380, delay: Math.min(i, 24) * 14, e: EASE.spring }));
  const sc = $('.hg-scroll', el); if (animate && sc) sc.scrollTop = 0;
  if (rest.length) {
    let i = 0; const idle = f => window.requestIdleCallback ? requestIdleCallback(f, { timeout: 160 }) : setTimeout(f, 30);
    const more = () => {
      if (job !== listJob || !box.isConnected) return;  /* a newer render took over */
      box.insertAdjacentHTML('beforeend', rest.slice(i, i + 2).map(([c, l]) => secHTML(c, l)).join('')); i += 2; updSecCounts();
      if (i < rest.length) idle(more);
      else if (S.q.length >= 2) { box.insertAdjacentHTML('beforeend', wingetSecHTML()); updWs(false); }
    };
    idle(more);
  }
}
function rerenderCatalog() { const el = $(`#v-${ID} .tab[data-tab="catalog"]`); if (el && $('.hg-list', el)) { renderList(false); noWinget(el); } }
function updSecCounts() {
  $$(`#v-${ID} [data-sc]`).forEach(s => {
    const c = s.dataset.sc, all = APPS.filter(a => a.cat === c), n = all.filter(a => S.sel.has(a.id)).length;
    const txt = n ? t('{n} of {total} selected', { n, total: all.length }) : nApps(all.length); if (s.textContent !== txt) s.textContent = txt;
    const b = $(`[data-all="${c}"]`, s.parentElement); if (b) { const pick = all.filter(a => !(opts().skip && S.inst.has(a.id))); const full = pick.length && pick.every(a => S.sel.has(a.id)); const l = full || !pick.length && n ? t('Clear') : t('Select all'); if (b.textContent !== l) b.textContent = l; b.dataset.mode = full || !pick.length && n ? 'clear' : 'all'; b.disabled = !pick.length && !n; }
  });
}
function catalogClick(e, el) {
  const tile = e.target.closest('.hg-app[data-app]'); if (tile) { const a = BY[tile.dataset.app]; toggleSel(a); anim($('.check', tile), [{ transform: 'scale(.7)' }, { transform: 'scale(1)' }], { d: 320, e: EASE.spring }); return; }
  const w = e.target.closest('.hg-wrow[data-w]'); if (w) { const a = (S.ws.items || []).find(x => x.id === w.dataset.w); if (a) { toggleSel(a); anim($('.check', w), [{ transform: 'scale(.7)' }, { transform: 'scale(1)' }], { d: 320, e: EASE.spring }); } return; }
  const all = e.target.closest('[data-all]'); if (all) { const c = all.dataset.all; const list = APPS.filter(a => a.cat === c);
    if (all.dataset.mode === 'clear') setMany(list, false); else { const n = setMany(list.filter(a => !(opts().skip && S.inst.has(a.id))), true); if (n) SH.toast(t('{n} apps added from {cat}.', { n, cat: CAT[c].n }), { group: 'hg-all' }); } return; }
  const rb = e.target.closest('.hg-rb[data-cat]'); if (rb && rb.dataset.cat !== S.cat) { S.cat = rb.dataset.cat; $$('.hg-rb', el).forEach(b => b.classList.toggle('on', b === rb)); renderList(true); return; }
  const f = e.target.closest('.hg-filt button[data-f]'); if (f && !f.classList.contains('on')) { $$('.hg-filt button', el).forEach(x => x.classList.toggle('on', x === f)); SH.placeSeg($('.hg-filt', el)); S.filter = f.dataset.f; renderList(true); return; }
  if (e.target.closest('[data-qx]')) { clearQuery(el); return; }
  if (e.target.closest('[data-wsgo]')) { wingetSearch(S.q, true); return; }
  if (sideClick(e)) return;
  const url = e.target.closest('[data-url]'); if (url) { SH.call('open_url', url.dataset.url); }
}

/* ---------------- winget search (anything outside the catalog) ---------------- */
async function wingetSearch(q, force) {
  q = (q || '').trim();
  if (q.length < 2) return;
  if (!force && S.ws.q === q && (S.ws.items || S.ws.busy)) return;
  if (S.ws.job) S.ws.job.cancel();
  S.ws = { q, items: null, busy: true, err: null, job: null, more: 0 }; updWs();
  const p = REAL ? SH.job(ID, 'search', [q]) : wait(800).then(() => ({ q, items: MOCK_SEARCH.filter(x => fold(`${x.name} ${x.id}`).includes(fold(q))) }));
  S.ws.job = p.cancel ? p : null;
  /* a slow winget search is followed from anywhere once it runs for a moment; a newer one cancels it silently */
  SH.activity.follow(ID, p, { key: 'search:' + q, label: t('Searching winget…'), summary: r => { const n = ((r && r.items) || []).length; return n === 1 ? t('1 result') : t('{n} results', { n }); } }).catch(() => {});
  let r; try { r = await p; } catch (e) { if (S.ws.q !== q) return; if (e.cancelled) return; S.ws.busy = false; S.ws.err = e.message; updWs(); return; }
  if (S.ws.q !== q) return;
  const ql = fold(q);
  const rank = x => { const n = fold(x.name); return n === ql ? 0 : n.startsWith(ql) ? 1 : n.includes(ql) ? 2 : fold(x.id).includes(ql) ? 3 : 4; };
  const items = ((r && r.items) || []).filter(x => !BY[x.id] && ID_RE.test(x.id)).map(x => ({ ...x, pub: x.source === 'msstore' ? 'Microsoft Store' : 'winget' }))
    .map((x, i) => [x, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([x]) => x);
  items.forEach(x => { if (x.installed) S.inst.add(x.id); });
  S.ws.items = items; S.ws.busy = false; S.ws.more = (r && r.more) || 0; updWs(true);
  loadIcons(items);
}
function wingetSecHTML() {
  return `<section class="hg-sec hg-ws"><div class="hg-sh"><span class="hg-si">${ic('package')}</span><b>${t('More on winget')}</b><span class="faint hg-wst"></span><span class="sp"></span></div><div class="hg-wbox">${wsBody()}</div></section>`;
}
function wsBody() {
  const w = S.ws;
  if (!S.winget) return `<div class="faint hg-wnote">${t("winget isn't available on this PC.")}</div>`;
  if (w.q !== S.q || (!w.items && !w.busy && !w.err)) return `<div class="hg-wnote"><button class="btn sm sec" data-wsgo>${ic('search')}${t('Search winget for “{q}”', { q: esc(S.q) })}</button></div>`;
  if (w.busy) return `<div class="hg-wl">${[0, 1, 2].map(i => `<div class="hg-wrow sk-app"><span class="sk" style="width:32px;height:32px;border-radius:9px;--dl:${i * .08}s"></span><span class="hg-wt"><span class="sk" style="height:11px;width:${36 + i * 9}%;--dl:${i * .08}s"></span><span class="sk" style="height:9px;width:${24 + i * 7}%;margin-top:7px;--dl:${i * .08}s"></span></span></div>`).join('')}</div>`;
  if (w.err) return `<div class="hg-warn">${ic('alert')}<span>${t("Couldn't search winget: {error}", { error: esc(w.err) })}</span><button class="btn sm sec" data-wsgo>${ic('refresh')}${t('Retry')}</button></div>`;
  if (!w.items.length) return `<div class="faint hg-wnote">${t('Nothing on winget matches that either.')}</div>`;
  return `<div class="hg-wl">${w.items.map(x => { const on = S.sel.has(x.id), inst = S.inst.has(x.id);
    return `<button class="hg-wrow${on ? ' on' : ''}${inst ? ' is-inst' : ''}" data-w="${esc(x.id)}" aria-pressed="${on}">${icon(x, 'sm')}<span class="hg-wt"><b>${esc(x.name)}</b><span>${esc(x.id)}</span></span>
      ${inst ? `<i class="hg-ok">${ic('check')}${t('Installed')}</i>` : ''}<span class="hg-wv">${esc(x.version || '')}</span><span class="chip hg-src">${x.source === 'msstore' ? 'Microsoft Store' : 'winget'}</span><span class="check${on ? ' on' : ''}">${ic('check')}</span></button>`; }).join('')}</div>
    ${w.more ? `<div class="faint hg-wnote">${t('{n} more results: type a more specific name.', { n: w.more })}</div>` : ''}`;
}
function updWs(animate) {
  const box = $(`#v-${ID} .hg-wbox`); if (!box) return;
  box.innerHTML = wsBody();
  const st = $(`#v-${ID} .hg-wst`); if (st) st.innerHTML = S.ws.busy ? `<span class="hg-spin"></span>${t('Searching winget…')}` : S.ws.items && S.ws.q === S.q ? (S.ws.items.length === 1 ? t('1 result') : t('{n} results', { n: S.ws.items.length })) : '';
  if (animate) $$('.hg-wrow', box).slice(0, 16).forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(0,8px,0)' }, { opacity: 1, transform: 'none' }], { d: 360, delay: i * 26, e: EASE.spring }));
}

/* ---------------- selection panel ---------------- */
function sideHTML() {
  return `<div class="hg-sh2"><h4>${t('Ready to install')}</h4><span class="sp"></span><button class="btn sm ghost" data-clear>${t('Clear')}</button></div>
    <div class="hg-count"><div class="big"><span class="hg-n">0</span><small class="hg-nl"></small></div><span class="muted hg-nsub"></span></div>
    <div class="hg-sscroll"><div class="hg-slist"></div></div>
    <div class="hg-opts">
      <div class="hg-opt"><span>${t('Install for')}</span><div class="seg hg-scope"><span class="ind"></span><button data-s="">${t('Default')}</button><button data-s="user">${t('Just me')}</button><button data-s="machine">${t('Everyone')}</button></div></div>
      <div class="hg-opt2"><div><b>${t('Skip what is already installed')}</b><span>${t("Those apps aren't touched or updated.")}</span></div><button class="toggle${opts().skip ? ' on' : ''}" data-skip aria-label="${esc(t('Skip what is already installed'))}"><i></i></button></div>
    </div>
    <button class="btn pri lg hg-go" data-go>${ic('hg-rocket')}<span>${t('Install')}</span></button>
    <div class="hg-sfoot"><button class="btn sm ghost" data-savekit>${ic('plus')}${t('Save as a kit')}</button><button class="btn sm ghost" data-gokits>${ic('package')}${t('Browse kits')}</button></div>`;
}
function placeScope(el, snap) {
  const seg = $('.hg-scope', el); if (!seg) return; const s = opts().scope || '';
  $$('button', seg).forEach(b => b.classList.toggle('on', b.dataset.s === s)); SH.placeSeg(seg, snap);
}
function sideRowHTML(a) {
  const inst = S.inst.has(a.id);
  return `<div class="hg-srow${inst ? ' is-inst' : ''}" data-srow="${esc(a.id)}">${icon(a, 'sm')}<span class="hg-st"><b>${esc(a.name)}</b><span>${inst ? (opts().skip ? t('Installed, will be skipped') : t('Installed, will be updated')) : esc(a.pub || (CAT[a.cat] || {}).n || 'winget')}</span></span>
    <button class="iconbtn hg-rm" data-unsel="${esc(a.id)}" aria-label="${esc(t('Remove {name}', { name: a.name }))}">${ic('x')}</button></div>`;
}
function fillSideList(animate) {
  const box = $(`#v-${ID} .hg-slist`); if (!box) return;
  const list = [...S.sel.values()].reverse();
  box.innerHTML = list.length ? list.map(sideRowHTML).join('') : `<div class="hg-sempty"><span class="hg-ei">${ic('hangar')}</span><b>${t('Nothing selected yet')}</b><span>${t('Tick the apps you want, or start from a kit.')}</span></div>`;
  if (animate) $$('.hg-srow', box).slice(0, 12).forEach((r, i) => anim(r, [{ opacity: 0, transform: 'translate3d(12px,0,0)' }, { opacity: 1, transform: 'none' }], { d: 360, delay: i * 22, e: EASE.spring }));
}
function sideRow(a, on) {
  const box = $(`#v-${ID} .hg-slist`); if (!box) return;
  if (on) {
    const empty = $('.hg-sempty', box); if (empty) empty.remove();
    box.insertAdjacentHTML('afterbegin', sideRowHTML(a));
    const row = box.firstElementChild; anim(row, [{ opacity: 0, transform: 'translate3d(16px,0,0) scale(.97)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 380, e: EASE.spring });
    const sc = box.parentElement; if (sc.scrollTop > 0) sc.scrollTo({ top: 0, behavior: SH.effInt() === 'min' ? 'auto' : 'smooth' });
  } else {
    const row = $(`[data-srow="${CSS.escape(a.id)}"]`, box); if (!row) return;
    const h = row.offsetHeight;
    anim(row, [{ opacity: 1, height: h + 'px' }, { opacity: 0, transform: 'translate3d(18px,0,0)', height: h + 'px', offset: .5 }, { opacity: 0, transform: 'translate3d(18px,0,0)', height: '0px', paddingTop: '0px', paddingBottom: '0px' }], { d: 340, e: EASE.out })
      .finished.then(() => { row.remove(); if (!S.sel.size) fillSideList(true); }).catch(() => row.remove());
  }
}
function updSide() {
  const el = $(`#v-${ID} .hg-side`); if (!el) return;
  const n = S.sel.size, go = toInstall().length, skip = n - go;
  const cnt = $('.hg-n', el); if (+(cnt.dataset.v || 0) !== n) SH.countUp(cnt, n, 420);
  $('.hg-nl', el).textContent = n === 1 ? t('app selected') : t('apps selected');
  $('.hg-nsub', el).textContent = !n ? t('Pick apps on the left, or start from a kit.') : skip ? (skip === 1 ? t('1 is already installed and will be skipped.') : t('{n} are already installed and will be skipped.', { n: skip })) : t('They install silently, one after another.');
  const b = $('[data-go]', el); b.disabled = !go || !(S.winget || S.dry); b.title = S.winget || S.dry ? '' : t("winget isn't available on this PC."); $('span', b).textContent = go ? (go === 1 ? t('Install 1 app') : t('Install {n} apps', { n: go })) : t('Install');
  $('[data-clear]', el).disabled = !n; $('[data-savekit]', el).disabled = !n;
  $$('.hg-srow', el).forEach(r => { const inst = S.inst.has(r.dataset.srow); r.classList.toggle('is-inst', inst); const a = S.sel.get(r.dataset.srow); const s = $('.hg-st>span', r);
    if (a && s) { const txt = inst ? (opts().skip ? t('Installed, will be skipped') : t('Installed, will be updated')) : (a.pub || (CAT[a.cat] || {}).n || 'winget'); if (s.textContent !== txt) s.textContent = txt; } });
}
function sideClick(e) {
  const rm = e.target.closest('[data-unsel]'); if (rm) { const a = S.sel.get(rm.dataset.unsel); if (a) toggleSel(a, false); return true; }
  if (e.target.closest('[data-clear]')) { const old = [...S.sel.values()]; if (!old.length) return true; setMany(old, false); SH.toast(t('Selection cleared.'), { action: { label: t('Undo'), sound: 'undo', run: () => setMany(old, true) }, group: 'hg-clear' }); return true; }
  const sb = e.target.closest('.hg-scope button'); if (sb && !sb.classList.contains('on')) { setOpt('scope', sb.dataset.s); placeScope(sb.closest('.hg-side')); return true; }
  const sk = e.target.closest('[data-skip]'); if (sk) { sk.classList.toggle('on'); setOpt('skip', sk.classList.contains('on')); updSide(); updSecCounts(); updHeader(); return true; }
  if (e.target.closest('[data-go]')) { startInstall(); return true; }
  if (e.target.closest('[data-savekit]')) { saveKitDialog([...S.sel.values()]); return true; }
  if (e.target.closest('[data-gokits]')) { ctxRef && ctxRef.setTab('kits'); return true; }
  return false;
}
function updHeader() {
  const b = $(`#v-${ID} .acts [data-hgo]`); if (!b) return; const n = toInstall().length;
  b.disabled = !n || !(S.winget || S.dry); const s = $('span', b); const txt = n ? (n === 1 ? t('Install 1 app') : t('Install {n} apps', { n })) : t('Install'); if (s.textContent !== txt) s.textContent = txt;
}

/* ---------------- dialogs ---------------- */
function dialog(html, onClick, cls = '') {
  const v = $(`#v-${ID}`); let d = $('.hg-dlg', v); if (d) d.remove();
  d = document.createElement('div'); d.className = 'hg-dlg'; d.innerHTML = `<div class="hg-dbox pan ${cls}">${html}</div>`; v.appendChild(d);
  anim(d, [{ opacity: 0 }, { opacity: 1 }], { d: 200 }); anim($('.hg-dbox', d), [{ opacity: 0, transform: 'translate3d(0,14px,0) scale(.96)' }, { opacity: 1, transform: 'none' }], { d: 420, e: EASE.spring });
  /* closing starts the fade: a second click on its button meanwhile (a double click on Install) does nothing */
  let shut = false;
  const close = () => { if (shut || !d.isConnected) return; shut = true; removeEventListener('keydown', key, true); anim(d, [{ opacity: 1 }, { opacity: 0 }], { d: 160 }).finished.then(() => d.remove()).catch(() => d.remove()); };
  const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('keydown', key, true);
  d.addEventListener('click', e => { if (shut) return; if (e.target === d || e.target.closest('[data-no]')) { close(); return; } onClick && onClick(e, close, d); });
  return { el: d, close };
}
const stack = (list, max = 7) => `<span class="hg-stack">${list.slice(0, max).map(a => icon(a, 'xs')).join('')}${list.length > max ? `<i class="hg-more">+${list.length - max}</i>` : ''}</span>`;

/* ---------------- install ---------------- */
function startInstall(list) {
  const o = opts();
  const sel = list || [...S.sel.values()];
  const go = sel.filter(a => !(o.skip && S.inst.has(a.id))), skipped = sel.length - go.length;
  if (!go.length) { SH.toast(sel.length ? t('Everything you picked is already installed.') : t('Pick at least one app.')); return; }
  if (!S.winget && !S.dry) { SH.toast(t("winget isn't available on this PC."), { kind: 'error' }); return; }
  const scopeTxt = o.scope === 'machine' ? t('For everyone on this PC.') : o.scope === 'user' ? t('Only for your account.') : t('Each app installs the way it prefers.');
  dialog(`<h3>${go.length === 1 ? t('Install 1 app?') : t('Install {n} apps?', { n: go.length })}</h3>
    <p class="muted">${t('They install silently, one after another, with winget. Some installers close the app they replace, and Windows may ask for permission on some of them.')} ${esc(scopeTxt)}${skipped ? ' ' + (skipped === 1 ? t('1 is already installed and will be skipped.') : t('{n} are already installed and will be skipped.', { n: skipped })) : ''}${S.dry ? ' ' + t('Dry run: nothing will really be installed.') : ''}</p>
    <div class="hg-clist">${go.slice(0, 12).map(a => `<div>${icon(a, 'xs')}<span>${esc(a.name)}</span></div>`).join('')}${go.length > 12 ? `<div class="faint hg-cmore">${t('and {n} more', { n: go.length - 12 })}</div>` : ''}</div>
    <div class="hg-dbtns"><button class="btn ghost" data-no>${t('Not now')}</button><button class="btn pri" data-yes>${ic('hg-rocket')}${go.length === 1 ? t('Install 1 app') : t('Install {n} apps', { n: go.length })}</button></div>`,
  async (e, close) => { if (!e.target.closest('[data-yes]')) return; close();
    /* asked before the queue starts (reopening as administrator would cut it off): Not now installs them anyway, with
       Windows asking for each one */
    if (o.scope === 'machine' && !state.admin && !await SH.adminFirst(t('to install for everyone without a Windows prompt for each app.'))) return;
    const added = enqueue(sel, o);
    if (!list) setMany(sel, false);
    if (ctxRef) ctxRef.setTab('queue');
    SH.toast(added === 1 ? t('1 app is on its way.') : t('{n} apps are on their way.', { n: added }), { group: 'hg-go' });
  });
}

/* ---------------- queue ---------------- */
const Q = { list: [], running: false, paused: false, timer: 0, total: new Spring(0, 80, 17), dirty: false, runs: new Map() };
const QACTIVE = ['queued', 'down', 'inst'];
function enqueue(apps, o) {
  const run = String(Date.now()); let added = 0;
  Q.runs.set(run, { at: Date.now(), scope: o.scope, done: false });
  apps.forEach(a => {
    if (Q.list.some(q => q.a.id === a.id && QACTIVE.includes(q.st))) return;
    const skip = o.skip && S.inst.has(a.id);
    Q.list.push({ a, st: skip ? 'skip' : 'queued', msg: skip ? t('Already installed') : null, p: 0, ph: 0, mb: null, sp: new Spring(0, 140, 20), run, o: { scope: o.scope, skip: o.skip } });
    if (!skip) added++;
  });
  renderQueue(true); startQueue(); publishQ();
  return added;
}
function startQueue() {
  if (Q.running || !Q.list.some(q => q.st === 'queued')) { renderQueueHead(); return; }
  Q.running = true; Q.paused = false; Q.summaryShown = false;
  Q.act = SH.activity.start(ID, { key: 'queue', label: t('Installing apps'), go: { tab: 'queue' } }); queueAct();
  if (REAL) runQueueReal(); else { clearInterval(Q.timer); Q.timer = setInterval(stepQueue, 60); }
  renderQueueHead();
}
async function runQueueReal() {
  for (;;) {
    if (Q.paused) break;
    const cur = Q.list.find(q => q.st === 'queued'); if (!cur) break;
    cur.st = 'down'; cur.p = 0; updQRow(cur); scrollQ(cur);
    const job = SH.job(ID, 'install', [[plain(cur.a)], { scope: cur.o.scope, skipInstalled: cur.o.skip, run: cur.run }], { sound: 'task', onProgress: m => {
      const s = m.data && m.data.items && m.data.items[0]; if (!s) return;
      const st = s.st === 'queued' ? 'down' : s.st; if (s.mb) cur.mb = s.mb; cur.p = s.p || 0;
      if ((s.note || null) !== (cur.note || null)) { cur.note = s.note || null; cur.noteAt = Date.now() - (s.quiet || 0) * 1000; cur.st = st; updQRow(cur); clearInterval(cur.noteTimer); if (cur.note) cur.noteTimer = setInterval(() => { if (cur.note) updQRow(cur, true); else clearInterval(cur.noteTimer); }, 20000); return; }
      if (st !== cur.st && ['down', 'inst'].includes(st)) { cur.st = st; updQRow(cur); } else updQRow(cur, true);
    }, onLog: lines => { const l = lines.filter(x => x && !/^[\s\-\\|/█▒]+$/.test(x)).pop(); if (l) cur.last = l; } });
    cur.job = job;
    try {
      const res = await job; const s = (res && res.items && res.items[0]) || { st: 'fail', msg: t('No answer from the engine') };
      cur.st = s.st === 'queued' ? 'fail' : s.st; cur.msg = s.msg; cur.note = null; clearInterval(cur.noteTimer); if (s.mb) cur.mb = s.mb; if (res && res.reboot) Q.reboot = true;
    } catch (e) { cur.st = e.cancelled ? 'cancel' : 'fail'; cur.msg = e.cancelled ? null : e.message; }
    if (cur.cancelAfter && cur.st !== 'done') cur.st = 'cancel';
    onItemEnd(cur);
    if (cur.cancelAfter) { Q.list.forEach(q => { if (q.st === 'queued') { q.st = 'cancel'; updQRow(q); } }); break; }
  }
  Q.running = false; queueEnded();
}
/* sample: simulation */
const fakeMb = id => 4 + [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % 140;
function stepQueue() {
  if (Q.paused) return;
  let cur = Q.list.find(q => q.st === 'down' || q.st === 'inst');
  if (!cur) {
    cur = Q.list.find(q => q.st === 'queued');
    if (!cur) { Q.running = false; clearInterval(Q.timer); queueEnded(); return; }
    cur.st = 'down'; cur.ph = 0; cur.mb = fakeMb(cur.a.id); updQRow(cur); scrollQ(cur);
  }
  const w = cur.mb || 40;
  if (cur.st === 'down') { cur.p = Math.min(1, cur.p + .07 / Math.max(.6, Math.min(2.6, w / 70))); if (cur.p >= 1) { cur.st = 'inst'; cur.ph = 0; updQRow(cur); } }
  else { cur.ph += .06 / Math.max(.6, Math.min(1.8, w / 160)); if (cur.ph >= 1) { const f = MOCK_FAIL[cur.a.id]; cur.st = f ? 'fail' : 'done'; cur.msg = f || null; onItemEnd(cur); } }
  updQRow(cur, true);
}
function onItemEnd(q) {
  if (q.st === 'done') { q.p = 1; S.inst.add(q.a.id); refreshInstalledMarks(); }
  updQRow(q); publishQ();
}
function queueEnded() {
  renderQueueHead(); publishQ(); finishedSummary(true);
  const done = Q.list.filter(q => q.st === 'done' && !q.logged);
  if (done.length) { done.forEach(q => { q.logged = true; });
    SH.logActivity(done.length === 1 ? t('{name} installed', { name: done[0].a.name }) : t('{n} apps installed', { n: done.length }), { sub: done.slice(0, 3).map(q => q.a.name).join(', ') + (done.length > 3 ? '…' : ''), ic: ID, go: ID, tab: 'history' }); }
  finishedToast();
  S.hist = null; const h = $(`#v-${ID} .tab[data-tab="history"]`); if (h && h.dataset.ready) loadHistory(h);
  if (REAL && done.length) setTimeout(() => scanInstalled(true, 'quiet'), 1200);
}
function finishedToast() {
  const c = counts(); if (c.queued || c.run) return;
  const act = Q.act; Q.act = null;
  if (!c.done && !c.fail) { if (act) act.end({ cancelled: true }); return; }
  const msg = [c.done === 1 ? t('1 app installed.') : t('{n} apps installed.', { n: c.done })];
  if (c.fail) msg.push(c.fail === 1 ? t('1 failed.') : t('{n} failed.', { n: c.fail }));
  const kind = c.fail ? (c.done ? 'warning' : 'error') : 'success';
  if (act && act.end({ ok: !!c.done, summary: msg.join(' '), error: c.done ? '' : msg.join(' '), kind })) return;
  SH.toast(msg.join(' '), c.fail ? { kind, action: { label: t('Retry'), run: retryFailed }, group: 'hg-done' } : { kind, group: 'hg-done' });
}
function counts() {
  const c = { done: 0, skip: 0, fail: 0, cancel: 0, queued: 0, run: 0 };
  Q.list.forEach(q => { if (q.st === 'down' || q.st === 'inst') c.run++; else c[q.st] = (c[q.st] || 0) + 1; });
  return c;
}
function publishQ() { const c = counts(); if (ctxRef) ctxRef.setBadge('queue', c.queued + c.run); }
function retryFailed() {
  const f = Q.list.filter(q => q.st === 'fail' || q.st === 'cancel'); if (!f.length) return;
  f.forEach(q => { q.st = 'queued'; q.p = 0; q.ph = 0; q.msg = null; q.cancelAfter = false; q.sp.set(0); updQRow(q); });
  if (ctxRef) ctxRef.setTab('queue');
  finishedSummary(); startQueue(); publishQ();
}
const QST = { queued: t('Waiting'), down: t('Downloading'), inst: t('Installing'), done: t('Installed'), skip: t('Already installed'), fail: t('Error'), cancel: t('Cancelled') };
const mbTxt = v => v == null || isNaN(v) ? '' : v >= 1024 ? fmt1(v / 1024) + ' ' + U('GB') : (v < 10 ? fmt1(v) : Math.round(v)) + ' ' + U('MB');
function qStateText(q) {
  if (q.note === 'uac' && (q.st === 'down' || q.st === 'inst')) return t('Windows is asking for permission: look for the flashing shield in the taskbar');
  if (q.note === 'quiet' && (q.st === 'down' || q.st === 'inst'))
    return t('{state} · no news for {min} min', { state: q.st === 'inst' ? t('Installing') : t('Downloading'), min: Math.max(1, Math.round((Date.now() - (q.noteAt || Date.now())) / 60000)) });
  if (q.st === 'down') return q.mb ? t('Downloading, {got} of {total}', { got: mbTxt(q.mb * q.p), total: mbTxt(q.mb) }) : q.p ? t('Downloading, {pct}%', { pct: Math.round(q.p * 100) }) : t('Getting ready…');
  if (q.st === 'inst') return q.cancelAfter ? t('Installing; will stop when it finishes') : t('Installing…');
  if (q.st === 'fail') return esc(q.msg || t('Error'));
  if (q.st === 'done' && q.msg) return esc(q.msg);
  if (q.st === 'skip') return esc(q.msg || QST.skip);
  return QST[q.st];
}
function qIcon(q, i) {
  if (q.st === 'done') return `<svg class="i hg-okmark" viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`;
  if (q.st === 'fail' || q.st === 'cancel') return `<button class="btn sm sec" data-retry="${i}">${ic('refresh')}${t('Retry')}</button>`;
  if (q.st === 'skip') return `<span class="hg-skipd">${ic('minus')}</span>`;
  if (q.st === 'down' || q.st === 'inst') return '<span class="hg-spin"></span>';
  return `<button class="iconbtn hg-qx" data-qrm="${i}" aria-label="${esc(t('Remove from the queue'))}">${ic('x')}</button>`;
}
function qRowHTML(q, i) {
  return `<div class="hg-qrow st-${q.st}" data-q="${i}">${icon(q.a)}<div class="hg-qt"><div class="hg-qtl"><b>${esc(q.a.name)}</b><span class="hg-qmb">${q.mb ? mbTxt(q.mb) : ''}</span></div><span class="hg-qs">${qStateText(q)}</span>
    <div class="hg-qbar"><span></span></div></div><span class="hg-qi">${qIcon(q, i)}</span></div>`;
}
/* the queue's activity: overall progress (each app counts the same) and the app being installed */
function queueAct() {
  if (!Q.act || !Q.act.open) return;
  const live = Q.list.filter(q => q.st !== 'cancel' && q.st !== 'skip'); if (!live.length) return;
  const part = q => q.st === 'done' || q.st === 'fail' ? 1 : q.st === 'down' ? (q.p || 0) * .8 : q.st === 'inst' ? .8 + .2 * Math.min(1, q.ph || 0) : 0;
  const cur = Q.list.find(q => q.st === 'down' || q.st === 'inst');
  Q.act.progress(live.reduce((a, q) => a + part(q), 0) / live.length, cur ? cur.a.name : null);
}
function updQRow(q, light) {
  queueAct();
  const i = Q.list.indexOf(q); const row = $(`#v-${ID} .hg-qrow[data-q="${i}"]`); Q.dirty = true; if (!row) return;
  const s = $('.hg-qs', row), txt = qStateText(q); if (s.innerHTML !== txt) s.innerHTML = txt;
  const mb = $('.hg-qmb', row), mt = q.mb ? mbTxt(q.mb) : ''; if (mb.textContent !== mt) mb.textContent = mt;
  if (light) return;
  row.className = `hg-qrow st-${q.st}`; $('.hg-qi', row).innerHTML = qIcon(q, i);
  if (q.st === 'done') { const m = $('.hg-okmark', row); if (m) anim(m, [{ strokeDashoffset: 24 }, { strokeDashoffset: 0 }], { d: 420 }); anim($('.hg-ic', row), [{ transform: 'scale(1)' }, { transform: 'scale(1.12)', offset: .35 }, { transform: 'scale(1)' }], { d: 460, e: EASE.spring }); }
  renderQueueHead();
}
function scrollQ(q) { const row = $(`#v-${ID} .hg-qrow[data-q="${Q.list.indexOf(q)}"]`); if (row && row.offsetParent) row.scrollIntoView({ block: 'nearest', behavior: SH.effInt() === 'min' ? 'auto' : 'smooth' }); }
function qProgress() {
  const live = Q.list.filter(q => q.st !== 'cancel' && q.st !== 'skip'); if (!live.length) return Q.list.length ? 1 : 0;
  const w = q => q.mb || fakeMb(q.a.id); const tot = live.reduce((a, q) => a + w(q), 0) || 1;
  const got = live.reduce((a, q) => a + (q.st === 'done' || q.st === 'fail' ? w(q) : q.st === 'down' ? w(q) * q.p * .8 : q.st === 'inst' ? w(q) * (.8 + .2 * Math.min(1, REAL ? .5 : q.ph)) : 0), 0);
  return got / tot;
}
function renderQueue(animateNew) {
  const el = $(`#v-${ID} .tab[data-tab="queue"]`); if (!el || !$('.hg-qlist', el)) return; const list = $('.hg-qlist', el);
  if (!Q.list.length) { list.innerHTML = `<div class="hg-qempty"><span class="hg-ei lg">${ic('hg-rocket')}</span><b>${t('The queue is empty')}</b><span>${t('Pick apps in the catalog or a kit, then press Install.')}</span><button class="btn sec" data-gocat>${ic('grid')}${t('Open the catalog')}</button></div>`; renderQueueHead(); finishedSummary(); return; }
  if ($('.hg-qempty', list)) list.innerHTML = '';
  const known = new Set($$('.hg-qrow', list).map(r => r.dataset.q)); let n = 0;
  Q.list.forEach((q, i) => { if (known.has(String(i))) return; list.insertAdjacentHTML('beforeend', qRowHTML(q, i)); const row = list.lastElementChild; q.bar = $('.hg-qbar>span', row); q.drawn = null;
    if (animateNew) anim(row, [{ opacity: 0, transform: 'translate3d(18px,0,0)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { d: 440, delay: Math.min(n++, 14) * 34, e: EASE.spring }); });
  renderQueueHead(); finishedSummary();
}
const RING = 2 * Math.PI * 52;
function renderQueueHead() {
  const el = $(`#v-${ID} .tab[data-tab="queue"]`); if (!el || !$('.hg-qctl', el)) return;
  const c = counts(), total = Q.list.length - c.cancel, fin = c.done + c.skip + c.fail;
  $('.hg-qnum', el).textContent = total ? t('{done} of {total} finished', { done: fin, total }) : t('Nothing queued');
  const cur = Q.list.find(q => q.st === 'down' || q.st === 'inst');
  const now = $('.hg-qnow', el); const nt = cur ? (cur.st === 'inst' ? t('Installing {name}…', { name: cur.a.name }) : t('Downloading {name}…', { name: cur.a.name })) : Q.paused && c.queued ? t('Paused') : total && !c.queued ? t('All done') : t('Ready for lift-off');
  if (now.textContent !== nt) { now.textContent = nt; anim(now, [{ opacity: 0, transform: 'translate3d(0,4px,0)' }, { opacity: 1, transform: 'none' }], { d: 280 }); }
  [['done', c.done], ['skip', c.skip], ['fail', c.fail], ['wait', c.queued + c.run]].forEach(([k, v]) => { const x = $(`[data-cnt="${k}"]`, el); if (x && x.textContent !== String(v)) { x.textContent = v; anim(x, [{ transform: 'scale(.7)', opacity: .3 }, { transform: 'scale(1)', opacity: 1 }], { d: 360, e: EASE.spring }); } });
  const ctl = $('.hg-qctl', el); const want = Q.running ? (Q.paused ? 'paused' : 'run') : (Q.list.length ? (c.queued ? 'idleq' : 'idle') : 'empty');
  if (ctl.dataset.mode !== want) {
    ctl.dataset.mode = want;
    ctl.innerHTML = want === 'empty' ? '' : want === 'idle' ? `<button class="btn sm ghost" data-qclear>${t('Clear the list')}</button>` : want === 'idleq' ? `<button class="btn sm ghost" data-qclear>${t('Clear the list')}</button><button class="btn sm sec" data-qresume>${ic('play')}${t('Resume')}</button>`
      : `<button class="btn sm sec" data-qpause>${ic(Q.paused ? 'play' : 'pause')}${Q.paused ? t('Resume') : t('Pause')}</button><button class="btn sm ghost" data-qcancel>${t('Cancel')}</button>`;
    $$('button', ctl).forEach((b, i) => anim(b, [{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'scale(1)' }], { d: 300, delay: i * 40, e: EASE.spring }));
  }
  el.querySelector('.hg-ringc').classList.toggle('is-paused', Q.paused);
  Q.dirty = true;
}
function finishedSummary(animate) {
  const el = $(`#v-${ID} .tab[data-tab="queue"]`); if (!el) return; const box = $('.hg-qsum', el); if (!box) return;
  const c = counts(), o = opts();
  let html;
  if (Q.list.length && !c.queued && !c.run) {
    const parts = [c.done === 1 ? t('1 app installed.') : t('{n} apps installed.', { n: c.done })];
    if (c.skip) parts.push(c.skip === 1 ? t('1 was already installed.') : t('{n} were already installed.', { n: c.skip }));
    if (c.fail) parts.push(c.fail === 1 ? t('1 failed.') : t('{n} failed.', { n: c.fail }));
    if (c.cancel) parts.push(c.cancel === 1 ? t('1 cancelled.') : t('{n} cancelled.', { n: c.cancel }));
    html = `<h4>${c.fail ? t('Finished, with some errors') : t('Lift-off complete')}</h4><p class="muted">${parts.join(' ')}${Q.reboot ? ' ' + t('Restart the PC to finish some of them.') : ''}</p>
      <div class="hg-sbtns">${c.fail + c.cancel ? `<button class="btn sm pri" data-qretry>${ic('refresh')}${t('Retry failed')}</button>` : ''}<button class="btn sm sec" data-qkit>${ic('plus')}${t('Save as a kit')}</button></div>`;
  } else {
    html = `<h4>${t('How it works')}</h4><p class="muted">${t('Each app downloads from its publisher through winget and installs silently, one at a time. You can keep using StellarHub meanwhile.')}</p>
      <p class="hg-scopet">${ic('user')}${o.scope === 'machine' ? t('Installing for everyone on this PC.') : o.scope === 'user' ? t('Installing only for your account.') : t('Each app installs the way it prefers.')}</p>
      ${o.scope === 'machine' && !state.admin ? `<p class="hg-warnp">${ic('shield')}${t('Windows may ask for permission on each app. Turn on administrator mode to avoid it.')}</p>` : ''}${S.dry ? `<p class="hg-warnp">${ic('info')}${t('Dry run: nothing will really be installed.')}</p>` : ''}`;
  }
  if (box.innerHTML !== html) { box.innerHTML = html; if (animate) anim(box, [{ opacity: 0, transform: 'translate3d(0,10px,0) scale(.98)' }, { opacity: 1, transform: 'none' }], { d: 420, e: EASE.spring }); }
}
/* bars and ring: only written while something moves (no per-frame work when idle) */
tickers.add(dt => {
  if (state.view !== ID || (!Q.running && !Q.dirty)) return;
  const el = $(`#v-${ID} .tab[data-tab="queue"]`); if (!el || !el.offsetParent || !$('.hg-ringv', el)) return;
  Q.total.t = qProgress(); Q.total.step(dt);
  let moving = !Q.total.idle; const v = Math.max(0, Math.min(1, Q.total.v));
  const pct = Math.round(v * 100); const pe = $('.hg-qpct', el); SH.rollNumber(pe, pct, { format: String });
  $('.hg-ringv', el).style.strokeDashoffset = (RING * (1 - v)).toFixed(2);
  Q.list.forEach(q => {
    q.sp.t = q.st === 'down' ? q.p : ['inst', 'done', 'fail', 'skip'].includes(q.st) ? 1 : 0; if (q.sp.idle && q.drawn === q.sp.t) return;
    q.sp.step(dt); moving = true; if (q.bar && q.bar.isConnected) q.bar.style.transform = `scaleX(${Math.max(0, q.sp.v).toFixed(4)})`; q.drawn = q.sp.idle ? q.sp.t : null;
  });
  if (!moving && !Q.running) Q.dirty = false;
});
function renderQueueTab(el) {
  el.classList.add('fill');
  el.innerHTML = `<div class="hg-q">
    <div class="pan hg-qmain" data-asm><div class="hg-qh"><h4>${t('Install queue')}</h4><span class="sp"></span><span class="hg-qctl"></span></div>
      <div class="hg-qscroll"><div class="hg-qlist"></div></div></div>
    <aside class="hg-qside">
      <div class="pan hg-ringc" data-asm>
        <svg class="hg-ring" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" class="hg-ringb"/><circle cx="60" cy="60" r="52" class="hg-ringv" style="stroke-dasharray:${RING.toFixed(2)};stroke-dashoffset:${RING.toFixed(2)}"/></svg>
        <div class="hg-ringt"><div class="big"><span class="hg-qpct">0</span><small>%</small></div><span class="muted hg-qnum"></span></div>
        <b class="hg-qnow"></b>
        <div class="hg-qcounts">${[['done', t('Installed'), 'ok'], ['skip', t('Already installed'), 'mute'], ['fail', t('Failed'), 'bad'], ['wait', t('Waiting'), 'acc']].map(([k, l, c]) => `<div class="hg-qc c-${c}"><i></i><span>${l}</span><b data-cnt="${k}">0</b></div>`).join('')}</div>
      </div>
      <div class="pan hg-qsum" data-asm></div>
    </aside></div>`;
  renderQueue(false); Q.dirty = true;
  el.addEventListener('click', e => {
    if (e.target.closest('[data-qpause]')) { Q.paused = !Q.paused; if (!Q.paused && REAL && !Q.running) startQueue(); renderQueueHead(); SH.toast(Q.paused ? (REAL ? t('Stops after the app installing now finishes.') : t('Queue paused.')) : t('Resuming.'), { group: 'hg-q' }); return; }
    if (e.target.closest('[data-qresume]')) { Q.paused = false; startQueue(); return; }
    if (e.target.closest('[data-qcancel]')) {
      Q.list.forEach(q => { if (q.st === 'queued') { q.st = 'cancel'; updQRow(q); } else if (q.st === 'down' && q.job) q.job.cancel(); else if (q.st === 'inst' && REAL) { q.cancelAfter = true; updQRow(q, true); } else if (!REAL && ['down', 'inst'].includes(q.st)) { q.st = 'cancel'; updQRow(q); } });
      if (!REAL) { Q.running = false; clearInterval(Q.timer); queueEnded(); }
      renderQueueHead(); publishQ(); SH.toast(REAL && Q.list.some(q => q.cancelAfter) ? t('The app installing now will finish; the rest is cancelled.') : t('Queue cancelled. What was already installed stays.'), { group: 'hg-q' }); return;
    }
    if (e.target.closest('[data-qclear]')) { Q.list = Q.list.filter(q => QACTIVE.includes(q.st)); $('.hg-qlist', el).innerHTML = ''; renderQueue(true); publishQ(); return; }
    const r = e.target.closest('[data-retry]'); if (r) { const q = Q.list[+r.dataset.retry]; if (!q) return; q.st = 'queued'; q.p = 0; q.ph = 0; q.msg = null; q.cancelAfter = false; q.sp.set(0); updQRow(q); finishedSummary(); startQueue(); publishQ(); return; }
    const rm = e.target.closest('[data-qrm]'); if (rm) { const q = Q.list[+rm.dataset.qrm]; if (q && q.st === 'queued') { q.st = 'cancel'; q.msg = null; updQRow(q); publishQ(); if (!Q.list.some(x => QACTIVE.includes(x.st))) queueEnded(); } return; }
    if (e.target.closest('[data-qretry]')) { retryFailed(); return; }
    if (e.target.closest('[data-qkit]')) { saveKitDialog(Q.list.filter(q => q.st !== 'cancel').map(q => q.a)); return; }
    if (e.target.closest('[data-gocat]')) { ctxRef && ctxRef.setTab('catalog'); }
  });
}

/* ---------------- kits ---------------- */
const kitApps = k => k.apps.map(x => typeof x === 'string' ? BY[x] : appOf(x)).filter(Boolean);
function kitCard(k, mine) {
  const apps = kitApps(k), inSel = apps.filter(a => S.sel.has(a.id)).length, inst = apps.filter(a => S.inst.has(a.id)).length;
  const full = apps.length && apps.every(a => S.sel.has(a.id) || (opts().skip && S.inst.has(a.id)));
  const sub = [nApps(apps.length), inst ? t('{n} installed', { n: inst }) : '', mine && k.at ? fdate(k.at) : ''].filter(Boolean).join(', ');
  return `<div class="pan hg-kit${mine ? ' mine' : ''}${full ? ' is-in' : ''}" data-kit="${esc(k.id)}">
    <div class="hg-kt"><span class="hg-ki" style="--c:${k.c || colorFor(k.name || k.n || 'k')}">${ic(k.ic || 'package')}</span><div class="hg-ktt"><b>${esc(k.n || k.name || t('My kit'))}</b><span class="muted">${esc(sub)}</span></div>
      ${mine ? `<button class="iconbtn hg-kdel" data-kdel="${esc(k.id)}" aria-label="${esc(t('Delete this kit'))}">${ic('trash')}</button>` : ''}</div>
    ${k.d ? `<p class="muted hg-kd">${esc(k.d)}</p>` : ''}
    ${stack(apps)}
    <div class="hg-kf">${mine ? `<button class="btn sm ghost" data-kshare="${esc(k.id)}" title="${esc(t('Share code'))}">${ic('hg-share')}<span>${t('Share')}</span></button><button class="btn sm ghost" data-kexport="${esc(k.id)}">${ic('download')}<span>${t('Export')}</span></button>` : `<button class="btn sm ghost" data-kcustom="${esc(k.id)}">${ic('sliders')}<span>${t('Customize')}</span></button>`}
      <span class="sp"></span>${full ? `<span class="chip ok hg-kin">${ic('check')}${t('In your selection')}</span>` : `<button class="btn sm sec" data-kadd="${esc(k.id)}">${ic('plus')}<span>${inSel ? t('Add the rest') : t('Add to selection')}</span></button>`}</div>
  </div>`;
}
const fdate = ms => new Date(ms).toLocaleDateString(SH.i18n.locale, { day: 'numeric', month: 'short', year: 'numeric' });
function renderKits(el) {
  el.dataset.ready = '1';
  el.innerHTML = `<div class="hg-kits">
    <div class="hg-kh" data-asm><div><h3>${t('Ready-made kits')}</h3><p class="muted">${t('Start from a kit and adjust it to taste. Apps you already have are skipped.')}</p></div></div>
    <div class="hg-kgrid hg-pre"></div>
    <div class="hg-kh" data-asm><div><h3>${t('Your kits')}</h3><p class="muted">${t('Save a selection to set up another PC the same way: as a file, or as a short code you can paste.')}</p></div><span class="sp"></span>
      <button class="btn sm ghost" data-kimport>${ic('upload')}${t('Import')}</button><button class="btn sm sec" data-ksave>${ic('plus')}${t('Save the selection as a kit')}</button></div>
    <div class="hg-kgrid hg-mine"></div></div>`;
  fillKits(el, true);
  el.addEventListener('click', e => kitsClick(e, el));
}
function fillKits(el, animate) {
  const pre = $('.hg-pre', el), mine = $('.hg-mine', el); if (!pre) return;
  pre.innerHTML = KITS.map(k => kitCard(k)).join('');
  const uk = userKits();
  mine.innerHTML = uk.length ? uk.map(k => kitCard(k, true)).join('') : `<div class="pan hg-kempty">${SH.emptyState({ art: 'first', small: true, title: t('No kits of your own yet'), text: t('Pick apps in the catalog, then save them here. Import a kit file or paste a code someone shared with you.') })}</div>`;
  const sb = $('[data-ksave]', el); if (sb) sb.disabled = !S.sel.size;
  if (animate) SH.assemble(el, 60, 30, '.hg-kit, .hg-kempty');
}
function findKit(id) { return KITS.find(k => k.id === id) || userKits().find(k => k.id === id); }
function addKit(k, only) {
  const apps = only || kitApps(k);
  const pick = apps.filter(a => !(opts().skip && S.inst.has(a.id)));
  const n = setMany(pick, true), skipped = apps.length - pick.length;
  const msg = n ? (n === 1 ? t('1 app added to your selection.') : t('{n} apps added to your selection.', { n })) : t('Those apps were already in your selection.');
  SH.toast(msg + (skipped ? ' ' + (skipped === 1 ? t('1 is already installed.') : t('{n} are already installed.', { n: skipped })) : ''), { action: { label: t('See the selection'), run: () => ctxRef && ctxRef.setTab('catalog') }, group: 'hg-kit' });
  const el = $(`#v-${ID} .tab[data-tab="kits"]`); if (el && el.dataset.ready) fillKits(el);
}
function kitsClick(e, el) {
  const add = e.target.closest('[data-kadd]'); if (add) { const k = findKit(add.dataset.kadd); if (k) addKit(k); return; }
  const cu = e.target.closest('[data-kcustom]'); if (cu) { const k = findKit(cu.dataset.kcustom); if (k) customizeKit(k); return; }
  const del = e.target.closest('[data-kdel]'); if (del) { const all = userKits(); const k = all.find(x => x.id === del.dataset.kdel); if (!k) return; const card = del.closest('.hg-kit');
    SH.sound('delete');
    saveKits(all.filter(x => x !== k));
    anim(card, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.94)' }], { d: 220 }).finished.then(() => fillKits(el)).catch(() => fillKits(el));
    SH.toast(t('Kit “{name}” deleted.', { name: k.name }), { action: { label: t('Undo'), sound: 'undo', run: () => { saveKits([k, ...userKits()]); fillKits(el, true); } } }); return; }
  const sh = e.target.closest('[data-kshare]'); if (sh) { const k = findKit(sh.dataset.kshare); if (k) shareDialog(k); return; }
  const ex = e.target.closest('[data-kexport]'); if (ex) { const k = findKit(ex.dataset.kexport); if (k) exportKit(k); return; }
  if (e.target.closest('[data-ksave]')) { saveKitDialog([...S.sel.values()]); return; }
  if (e.target.closest('[data-kimport]')) { importDialog(); }
}
function customizeKit(k) {
  const apps = kitApps(k); const sk = opts().skip;
  const on = new Set(apps.filter(a => !(sk && S.inst.has(a.id))).map(a => a.id));
  const label = () => on.size === 1 ? t('Add 1 app') : t('Add {n} apps', { n: on.size });
  const d = dialog(`<h3>${esc(k.n)}</h3><p class="muted">${esc(k.d || '')} ${t('Untick what you don’t want.')}</p>
    <div class="hg-cgrid">${apps.map(a => `<button class="hg-crow${on.has(a.id) ? ' on' : ''}${S.inst.has(a.id) ? ' is-inst' : ''}" data-c="${esc(a.id)}">${icon(a, 'sm')}<span class="hg-st"><b>${esc(a.name)}</b><span>${S.inst.has(a.id) ? t('Installed') : esc(a.desc || a.pub || '')}</span></span><span class="check${on.has(a.id) ? ' on' : ''}">${ic('check')}</span></button>`).join('')}</div>
    <div class="hg-dbtns"><button class="btn ghost" data-no>${t('Cancel')}</button><button class="btn pri" data-yes>${ic('plus')}<span>${label()}</span></button></div>`,
  (e, close, root) => {
    const r = e.target.closest('[data-c]'); if (r) { const id = r.dataset.c; if (on.has(id)) on.delete(id); else on.add(id); r.classList.toggle('on', on.has(id)); $('.check', r).classList.toggle('on', on.has(id));
      anim($('.check', r), [{ transform: 'scale(.7)' }, { transform: 'scale(1)' }], { d: 300, e: EASE.spring }); const y = $('[data-yes]', root); y.disabled = !on.size; $('span', y).textContent = label(); return; }
    if (e.target.closest('[data-yes]')) { close(); addKit(k, apps.filter(a => on.has(a.id))); }
  }, 'wide');
  return d;
}
function saveKitDialog(apps) {
  apps = (apps || []).filter(Boolean);
  if (!apps.length) { SH.toast(t('Pick at least one app.')); return; }
  const d = dialog(`<h3>${t('Save as a kit')}</h3><p class="muted">${t('{n} apps. You can share the kit as a file or a code, or install it again later.', { n: apps.length })}</p>
    ${stack(apps, 12)}
    <label class="field hg-kname">${ic('package')}<input maxlength="60" spellcheck="false" placeholder="${esc(t('Kit name'))}" value="${esc(t('My kit'))}"></label>
    <div class="hg-dbtns"><button class="btn ghost" data-no>${t('Cancel')}</button><button class="btn pri" data-yes>${ic('check')}${t('Save')}</button></div>`,
  (e, close, root) => { if (!e.target.closest('[data-yes]')) return; const name = $('input', root).value.trim() || t('My kit'); close(); saveKit(name, apps); });
  const inp = $('input', d.el); setTimeout(() => { inp.focus(); inp.select(); }, 60);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') $('[data-yes]', d.el).click(); });
}
function saveKit(name, apps) {
  const k = { id: 'k' + Date.now().toString(36), name: name.slice(0, 60), at: Date.now(), apps: apps.map(a => BY[a.id] ? a.id : { id: a.id, name: a.name, source: a.source || 'winget' }) };
  saveKits([k, ...userKits()]);
  const el = $(`#v-${ID} .tab[data-tab="kits"]`); if (el && el.dataset.ready) fillKits(el, true);
  SH.toast(t('Kit “{name}” saved.', { name: k.name }), { action: { label: t('See your kits'), run: () => ctxRef && ctxRef.setTab('kits') }, group: 'hg-ksave' });
  return k;
}
/* share codes: HG1.<bitmask of catalog positions>[.<base64url JSON {n: name, x: [[id, name], ...]} for the rest>] */
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
function kitCode(k) {
  const mask = [], extra = [];
  kitApps(k).forEach(a => { const c = BY[a.id]; if (c) mask[c.n >> 3] = (mask[c.n >> 3] || 0) | (1 << (c.n & 7)); else extra.push([a.id, a.name]); });
  for (let i = 0; i < mask.length; i++) mask[i] = mask[i] || 0;
  const meta = {}; if (k.name) meta.n = k.name; if (extra.length) meta.x = extra;
  return 'HG1.' + b64u(mask) + (Object.keys(meta).length ? '.' + b64u(new TextEncoder().encode(JSON.stringify(meta))) : '');
}
function parseCode(s) {
  const m = String(s || '').trim().match(/HG1\.([A-Za-z0-9_-]*)(?:\.([A-Za-z0-9_-]+))?/); if (!m) return null;
  try {
    const apps = []; unb64u(m[1]).forEach((b, i) => { for (let j = 0; j < 8; j++) if (b & (1 << j)) { const a = CATALOG[i * 8 + j]; if (a) apps.push(a); } });
    let name = '';
    if (m[2]) { const meta = JSON.parse(new TextDecoder().decode(unb64u(m[2]))); name = String(meta.n || '').slice(0, 60);
      (Array.isArray(meta.x) ? meta.x : []).forEach(x => { const [id, n] = Array.isArray(x) ? x : [x, x]; if (ID_RE.test(String(id)) && !apps.some(a => a.id === id)) apps.push(appOf({ id, name: String(n || id).slice(0, 80) })); }); }
    return apps.length ? { name, apps } : null;
  } catch { return null; }
}
function shareDialog(k) {
  const code = kitCode(k);
  const d = dialog(`<h3>${t('Share “{name}”', { name: esc(k.name) })}</h3><p class="muted">${t('Paste this code in App Hangar on another PC (Kits, Import) to get the same apps.')}</p>
    <div class="hg-code"><code>${esc(code)}</code><button class="btn sm sec" data-copy>${ic('copy')}${t('Copy')}</button></div>
    <div class="hg-dbtns"><button class="btn ghost" data-kexp>${ic('download')}${t('Export as a file')}</button><span class="sp"></span><button class="btn sec" data-no>${t('Done')}</button></div>`,
  async (e, close) => {
    if (e.target.closest('[data-copy]')) { SH.sound.claim(); let ok = false; try { await navigator.clipboard.writeText(code); ok = true; } catch { ok = false; }
      if (!ok) { const r = document.createRange(); r.selectNodeContents($('code', d.el)); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); ok = document.execCommand && document.execCommand('copy'); }
      if (ok) SH.sound('copy');
      SH.toast(ok ? t('Code copied.') : t('Select the code and copy it with Ctrl+C.'), ok ? { group: 'hg-copy' } : { group: 'hg-copy', kind: 'warning' }); return; }
    if (e.target.closest('[data-kexp]')) { close(); exportKit(k); }
  });
  return d;
}
async function exportKit(k) {
  const payload = { name: k.name, apps: kitApps(k).map(plain) };
  if (REAL) {
    let r; try { r = await SH.engine(ID, 'export_kit', payload); } catch (e) { SH.toast(t("Couldn't save the file: {error}", { error: e.message }), { kind: 'error' }); return; }
    if (r && r.path) SH.toast(t('Kit saved to {path}', { path: r.path }), { group: 'hg-exp' }); else if (r && r.error) SH.toast(r.error, { kind: 'error' });
    return;
  }
  const blob = new Blob([JSON.stringify({ format: 'stellarhub-hangar-kit', version: 1, ...payload }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (k.name || 'App Hangar kit').replace(/[<>:"/\\|?*]+/g, '') + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
function importDialog() {
  const d = dialog(`<h3>${t('Import a kit')}</h3><p class="muted">${t('Paste a code someone shared with you, or open a kit file.')}</p>
    <label class="field hg-kname">${ic('hg-share')}<input spellcheck="false" placeholder="HG1.…"></label><p class="hg-ierr" hidden></p>
    <div class="hg-dbtns"><button class="btn ghost" data-kfile>${ic('folder')}${t('Open a file')}</button><span class="sp"></span><button class="btn ghost" data-no>${t('Cancel')}</button><button class="btn pri" data-yes>${ic('check')}${t('Import')}</button></div>
    <input type="file" accept=".json,application/json" hidden data-fin>`,
  async (e, close, root) => {
    const err = m => { const p = $('.hg-ierr', root); p.textContent = m; p.hidden = false; anim(p, [{ opacity: 0, transform: 'translate3d(0,-4px,0)' }, { opacity: 1, transform: 'none' }], { d: 260 }); };
    if (e.target.closest('[data-yes]')) { const k = parseCode($('input', root).value); if (!k) { err(t("That doesn't look like an App Hangar code.")); return; } close(); imported(k); return; }
    if (e.target.closest('[data-kfile]')) {
      if (REAL) { let r; try { r = await SH.engine(ID, 'import_kit'); } catch (er) { err(er.message); return; } if (!r) return; if (r.error) { err(r.error); return; } close(); imported({ name: r.name, apps: r.apps.map(appOf) }); return; }
      $('[data-fin]', root).click();
    }
  });
  const inp = $('input', d.el); setTimeout(() => inp.focus(), 60);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') $('[data-yes]', d.el).click(); });
  $('[data-fin]', d.el).addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return;
    try { const j = JSON.parse(await f.text()); const apps = (Array.isArray(j) ? j : j.apps || []).map(x => typeof x === 'string' ? { id: x } : x).filter(x => x && ID_RE.test(String(x.id || ''))).map(appOf);
      if (!apps.length) throw new Error('empty'); d.close(); imported({ name: String(j.name || '').slice(0, 60), apps }); }
    catch { const p = $('.hg-ierr', d.el); p.textContent = t("That file isn't an App Hangar kit."); p.hidden = false; } });
}
function imported(k) {
  const saved = saveKit(k.name || t('Imported kit'), k.apps);
  customizeKit({ id: saved.id, n: saved.name, d: t('Imported with {n} apps.', { n: k.apps.length }), apps: saved.apps });
}

/* ---------------- history ---------------- */
function renderHistory(el) {
  el.dataset.ready = '1'; el.classList.add('fill');
  el.innerHTML = `<div class="hg-h"><div class="hg-hmain"><div class="hg-hlist">${[0, 1, 2].map(i => `<div class="pan hg-run"><div class="hg-rh"><span class="sk" style="width:38px;height:38px;border-radius:var(--r-s);--dl:${i * .1}s"></span><div style="flex:1"><span class="sk" style="display:block;height:12px;width:${30 + i * 8}%;--dl:${i * .1}s"></span><span class="sk" style="display:block;height:9px;width:${20 + i * 6}%;margin-top:8px;--dl:${i * .1}s"></span></div></div><div class="hg-ritems">${[0, 1, 2, 3, 4].map(() => '<span class="sk" style="width:120px;height:30px;border-radius:99px"></span>').join('')}</div></div>`).join('')}</div></div>
    <aside class="hg-hside"><div class="pan hg-hstat" data-asm></div></aside></div>`;
  loadHistory(el);
  el.addEventListener('click', e => {
    const rr = e.target.closest('[data-rretry]'); if (rr) { const run = (S.hist || []).find(r => r.run === rr.dataset.rretry); if (!run) return; const f = run.items.filter(x => x.st === 'fail').map(appOf); startInstall(f.length ? f : run.items.map(appOf)); return; }
    const rk = e.target.closest('[data-rkit]'); if (rk) { const run = (S.hist || []).find(r => r.run === rk.dataset.rkit); if (run) saveKitDialog(run.items.filter(x => x.st !== 'fail').map(appOf)); return; }
    if (e.target.closest('[data-hclear]')) { SH.sound('delete'); clearHistory(el); return; }
    if (e.target.closest('[data-gocat]')) { ctxRef && ctxRef.setTab('catalog'); }
  });
}
async function loadHistory(el) {
  if (!S.hist) { try { S.hist = REAL ? (await SH.engine(ID, 'history')) || [] : await wait(500).then(MOCK_HIST); S.histErr = null; } catch (e) { S.hist = []; S.histErr = e.message; } }
  fillHistory(el, true);
}
function fillHistory(el, animate) {
  const box = $('.hg-hlist', el), side = $('.hg-hstat', el); if (!box) return;
  const runs = S.hist || [];
  const all = runs.flatMap(r => r.items || []); const ok = all.filter(x => x.st === 'done').length;
  box.innerHTML = runs.length ? runs.map(r => {
    const items = r.items || []; const c = { done: 0, skip: 0, fail: 0 }; items.forEach(x => { c[x.st] = (c[x.st] || 0) + 1; });
    const when = new Date((r.at || 0) * 1000);
    const scope = r.scope === 'machine' ? t('for everyone') : r.scope === 'user' ? t('only for you') : '';
    return `<div class="pan hg-run" data-run="${esc(r.run)}"><div class="hg-rh"><span class="hg-ri">${ic('hg-rocket')}</span><div class="hg-rt"><b>${esc(when.toLocaleDateString(SH.i18n.locale, { weekday: 'long', day: 'numeric', month: 'long' }))}<em>${esc(when.toLocaleTimeString(SH.i18n.locale, { hour: '2-digit', minute: '2-digit' }))}</em></b>
      <span class="muted">${[nApps(items.length), scope].filter(Boolean).join(', ')}</span></div>
      <span class="hg-rchips">${c.done ? `<span class="chip ok">${t('{n} installed', { n: c.done })}</span>` : ''}${c.skip ? `<span class="chip">${t('{n} skipped', { n: c.skip })}</span>` : ''}${c.fail ? `<span class="chip bad">${t('{n} failed', { n: c.fail })}</span>` : ''}${r.dry ? `<span class="chip warn">${t('Dry run')}</span>` : ''}</span>
      <span class="sp"></span><button class="btn sm ghost" data-rkit="${esc(r.run)}">${ic('plus')}${t('Save as a kit')}</button><button class="btn sm sec" data-rretry="${esc(r.run)}">${ic('refresh')}${c.fail ? t('Retry failed') : t('Install again')}</button></div>
      <div class="hg-ritems">${items.map(x => `<span class="hg-hi st-${esc(x.st)}" title="${esc(x.msg || '')}">${icon(appOf(x), 'xs')}<span>${esc(x.name || x.id)}</span>${x.st === 'fail' ? ic('alert') : x.st === 'skip' ? ic('minus') : ic('check')}</span>`).join('')}</div>
      ${items.filter(x => x.st === 'fail' && x.msg).map(x => `<p class="hg-rerr">${ic('alert')}<b>${esc(x.name || x.id)}</b><span>${esc(x.msg)}</span></p>`).join('')}</div>`; }).join('')
    : `<div class="pan hg-hempty"><span class="hg-ei lg">${ic('clock')}</span><b>${t('Nothing installed with App Hangar yet')}</b><span class="muted">${S.histErr ? t("Couldn't read the history: {error}", { error: esc(S.histErr) }) : t('Every batch you install shows up here, with what worked and what didn’t.')}</span><button class="btn sec" data-gocat>${ic('grid')}${t('Open the catalog')}</button></div>`;
  side.innerHTML = `<h4>${t('History')}</h4><div class="hg-hbig"><div class="big"><span class="hg-hn">0</span></div><span class="muted">${ok === 1 ? t('app installed with App Hangar') : t('apps installed with App Hangar')}</span></div>
    <div class="hg-hrows">${[[t('Batches'), runs.length], [t('Failed'), all.filter(x => x.st === 'fail').length], [t('Last batch'), runs[0] ? fdate((runs[0].at || 0) * 1000) : '—']].map(([l, v]) => `<div><span class="muted">${l}</span><b>${esc(String(v))}</b></div>`).join('')}</div>
    <p class="faint hg-hnote">${t('The history stays on this PC.')}</p>${runs.length ? `<button class="btn sm ghost" data-hclear>${ic('trash')}${t('Clear the history')}</button>` : ''}`;
  SH.countUp($('.hg-hn', side), ok, 700);
  if (animate) SH.assemble(el, 0, 40, '.hg-run, .hg-hempty');
  $$('.hg-run', box).forEach(r => loadIcons([...r.querySelectorAll('.hg-ic')].map(x => appOf({ id: x.dataset.ic }))));
}
async function clearHistory(el) {
  const old = S.hist || [];
  if (REAL) { try { await SH.engine(ID, 'history_clear'); } catch (e) { SH.toast(t("Couldn't do it: {error}", { error: e.message }), { kind: 'error' }); return; } }
  S.hist = []; fillHistory(el, true);
  SH.toast(t('History cleared.'), { action: { label: t('Undo'), sound: 'undo', run: async () => { if (REAL) { try { await SH.engine(ID, 'history_restore', old); } catch { return; } } S.hist = old; fillHistory(el, true); } } });
}

/* ---------------- registration ---------------- */
SH.module({
  id: ID, real: true,
  actions(el, ctx) {
    ctxRef = ctx;
    el.innerHTML = `<button class="btn sec" data-rescan>${ic('refresh')}${t('Check again')}</button><button class="btn pri" data-hgo disabled>${ic('hg-rocket')}<span>${t('Install')}</span></button>`;
    el.addEventListener('click', e => {
      if (e.target.closest('[data-hgo]')) { startInstall(); return; }
      const r = e.target.closest('[data-rescan]'); if (r) { SH.sound('refresh'); anim($('svg', r), [{ transform: 'rotate(0)' }, { transform: 'rotate(360deg)' }], { d: 900, e: EASE.io });
        scanInstalled(true, 'user').then(() => { if (!S.scanTold) SH.toast(t('{n} apps from the catalog are installed.', { n: APPS.filter(a => S.inst.has(a.id)).length }), { group: 'hg-scan' }); }); }
    });
  },
  renderTab(tab, el) {
    const R = { catalog: renderCatalog, kits: renderKits, queue: renderQueueTab, history: renderHistory }[tab];
    if (R) R(el);
  },
  enterTab(tab, el) {
    if (tab === 'catalog') { updSide(); updHeader(); requestAnimationFrame(() => { SH.placeSeg($('.hg-filt', el), true); placeScope(el, true); }); }
    if (tab === 'kits' && el.dataset.ready) fillKits(el);
    if (tab === 'queue') { renderQueue(false); Q.dirty = true; }
    if (tab === 'history' && el.dataset.ready) { if (!S.hist) loadHistory(el); }
  },
  enter() { restoreSel(); boot(); updHeader(); },
  leave() {},
});
SH.actions.add([
  { t: t('Install several apps at once'), go: ID, tab: 'catalog', ic: ID },
  { t: t('Set up a new PC with a kit'), go: ID, tab: 'kits', ic: 'package' },
  { t: t('See what App Hangar installed'), go: ID, tab: 'history', ic: 'clock' },
]);
})();
