; StellarHub installer (Inno Setup 6.7 or later). Built by packaging/build.ps1, which passes the version:
;   ISCC.exe /DAppVersion=0.2.0 packaging\StellarHub.iss
;
; What it does, and nothing else: copies StellarHub to the user's own programs folder (%LOCALAPPDATA%\Programs, no
; administrator rights, no Windows prompt) or, if the user picks "for all users", to Program Files; adds a Start menu
; shortcut, downloads and installs the WebView2 runtime from Microsoft only if Windows lacks it, applies the choices made
; on the options page (desktop shortcut, open with Windows, always as administrator, the widget at startup, updates, the
; app's language), and registers a normal uninstaller. It creates no scheduled task: a per-user install updates itself
; without one, and an all-users install makes its update task the first time it updates (Windows asks once, see
; stellarhub/engine/selfupdate.py).
; The uninstaller also removes what the app registered itself (its scheduled tasks and "open with Windows" entry).
; /ALLUSERS and /CURRENTUSER choose the mode from the command line (silent installs default to the current user); an
; existing all-users install is upgraded in place whichever is given (UsePreviousPrivileges).
;
; /SELFUPDATE=<path of state.json> is how StellarHub's updater runs it (see stellarhub/engine/selfupdate.py), with
; /SILENT: Setup shows only its small progress window (no pages, no questions). It writes "done" or "failed" to that
; file when it ends, and opens StellarHub itself the moment the files are in place (or, if the installation failed,
; the previous version again), so nothing is left waiting on a helper.
;
; The wizard follows the Windows display language (English, Spanish, Portuguese, Italian, French, Chinese, Japanese or Russian);
; /LANG=spanish (english, portuguese, italian, french, chinesesimplified, japanese, russian) forces one.
; Silent installs keep the current settings, or use the defaults on a first install. They can also set the options:
;   /OPTIONS=desktop,startup,admin,widget,updates   (the ones listed are turned on, the rest off)
;   /APPLANG=es                             (en, es, pt, it, fr, zh, ja, ru)

#ifndef AppVersion
  #error Pass the version: ISCC /DAppVersion=x.y.z StellarHub.iss
#endif

#define AppName "StellarHub"
#define AppExe "StellarHub.exe"
#define AppUrl "https://github.com/estebanarosemena/StellarHub"
#define A "..\build\assets\"

[Setup]
; never change AppId: Windows uses it to recognize upgrades and the uninstaller
AppId={{0F1795D8-7D52-45CC-8518-7A1E4E76E43E}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Esteban Arosemena
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/issues
AppUpdatesURL={#AppUrl}/releases
AppCopyright=Copyright (C) Esteban Arosemena. GNU GPL v3.
AppComments=The control center for your Windows PC.

DefaultDirName={autopf}\{#AppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
; the options page is the last step: its button says Install (see CurPageChanged)
DisableReadyPage=yes
DisableWelcomePage=no
; no language dialog: the wizard always follows the Windows display language, also when updating
ShowLanguageDialog=no
LanguageDetectionMethod=uilanguage
UsePreviousLanguage=no
; per-user by default (no administrator rights, no UAC, installs into %LOCALAPPDATA%\Programs): the setup offers
; "Install for me only (recommended)" or "for all users", and /ALLUSERS or /CURRENTUSER decide silently. An install
; that already exists keeps its mode, so an all-users install upgrades in place.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog commandline
UsePreviousPrivileges=yes
UsedUserAreasWarning=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; WebView2 needs Windows 10 1809 or later
MinVersion=10.0.17763

; dark "polar" style on StellarHub's own deep-space navy, title bar included, no divider lines
WizardStyle=modern dark polar hidebevels includetitlebar
WizardBackColor=#0A1122
WizardBackImageFile={#A}wizard-back-596.png,{#A}wizard-back-796.png,{#A}wizard-back-994.png,{#A}wizard-back-1272.png,{#A}wizard-back-1630.png
WizardImageFile={#A}wizard-202.png,{#A}wizard-269.png,{#A}wizard-336.png,{#A}wizard-403.png,{#A}wizard-534.png
WizardSmallImageFile={#A}wizard-small-58.png,{#A}wizard-small-77.png,{#A}wizard-small-97.png,{#A}wizard-small-116.png,{#A}wizard-small-159.png
SetupIconFile={#A}StellarHub.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
; Inno names the uninstaller unins000.exe; keep it out of sight in its own folder (it is used from Settings > Apps)
UninstallFilesDir={app}\uninstall

OutputDir=..\dist
OutputBaseFilename=StellarHub-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes

; the installer first asks a running StellarHub to close (see PrepareToInstall); this is the fallback
CloseApplications=yes
RestartApplications=no
SetupLogging=yes

VersionInfoVersion={#AppVersion}
VersionInfoCompany=Esteban Arosemena
VersionInfoDescription={#AppName} Setup
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}
VersionInfoCopyright=Copyright (C) Esteban Arosemena

[Languages]
; the language codes the app uses for each one are in AppLangOf, in [Code]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "portuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "italian"; MessagesFile: "compiler:Languages\Italian.isl"
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
; unofficial translation from the Inno Setup project (jrsoftware/issrc, tag is-6_7_3), unchanged
Name: "chinesesimplified"; MessagesFile: "languages\ChineseSimplified.isl"
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Messages]
; no boilerplate about the buttons on the welcome and finish pages
ClickNext=
ClickFinish=
english.WelcomeLabel1=Welcome to StellarHub
english.WelcomeLabel2=This will install [name/ver] on your PC.%n%nLive hardware stats, drivers, apps, disk space, cleanup and hardware tests: everything your PC needs, in one place.
english.FinishedHeadingLabel=StellarHub is ready
english.FinishedLabelNoIcons=StellarHub is installed.
english.FinishedLabel=StellarHub is installed. You can open it any time from the Start menu.
spanish.WelcomeLabel1=Te damos la bienvenida a StellarHub
spanish.WelcomeLabel2=Se instalará [name/ver] en tu PC.%n%nEstadísticas del hardware en vivo, controladores, aplicaciones, espacio en disco, limpieza y pruebas de hardware: todo lo que tu PC necesita, en un solo lugar.
spanish.FinishedHeadingLabel=StellarHub está listo
spanish.FinishedLabelNoIcons=StellarHub ya está instalado.
spanish.FinishedLabel=StellarHub ya está instalado. Puedes abrirlo cuando quieras desde el menú Inicio.
portuguese.WelcomeLabel1=Boas-vindas ao StellarHub
portuguese.WelcomeLabel2=O [name/ver] será instalado no seu PC.%n%nEstatísticas do hardware em tempo real, drivers, aplicativos, espaço em disco, limpeza e testes de hardware: tudo o que o seu PC precisa, em um só lugar.
portuguese.FinishedHeadingLabel=O StellarHub está pronto
portuguese.FinishedLabelNoIcons=O StellarHub foi instalado.
portuguese.FinishedLabel=O StellarHub foi instalado. Você pode abri-lo quando quiser pelo menu Iniciar.
italian.WelcomeLabel1=Benvenuto in StellarHub
italian.WelcomeLabel2=Verrà installato [name/ver] sul tuo PC.%n%nStatistiche hardware in tempo reale, driver, app, spazio su disco, pulizia e test dell'hardware: tutto ciò che serve al tuo PC, in un unico posto.
italian.FinishedHeadingLabel=StellarHub è pronto
italian.FinishedLabelNoIcons=StellarHub è installato.
italian.FinishedLabel=StellarHub è installato. Puoi aprirlo in qualsiasi momento dal menu Start.
french.WelcomeLabel1=Bienvenue dans StellarHub
french.WelcomeLabel2=[name/ver] va être installé sur votre PC.%n%nStatistiques matérielles en direct, pilotes, applications, espace disque, nettoyage et tests matériels : tout ce dont votre PC a besoin, au même endroit.
french.FinishedHeadingLabel=StellarHub est prêt
french.FinishedLabelNoIcons=StellarHub est installé.
french.FinishedLabel=StellarHub est installé. Vous pouvez l'ouvrir à tout moment depuis le menu Démarrer.
chinesesimplified.WelcomeLabel1=欢迎使用 StellarHub
chinesesimplified.WelcomeLabel2=即将在您的电脑上安装 [name/ver]。%n%n实时硬件状态、驱动程序、应用、磁盘空间、清理和硬件测试：电脑所需的一切，尽在一处。
chinesesimplified.FinishedHeadingLabel=StellarHub 已准备就绪
chinesesimplified.FinishedLabelNoIcons=StellarHub 已安装完成。
chinesesimplified.FinishedLabel=StellarHub 已安装完成。您可以随时从“开始”菜单打开它。
japanese.WelcomeLabel1=StellarHub へようこそ
japanese.WelcomeLabel2=お使いの PC に [name/ver] をインストールします。%n%nリアルタイムのハードウェア情報、ドライバー、アプリ、ディスク容量、クリーンアップ、ハードウェア テスト: PC に必要なものがすべて 1 か所に揃っています。
japanese.FinishedHeadingLabel=StellarHub の準備ができました
japanese.FinishedLabelNoIcons=StellarHub がインストールされました。
japanese.FinishedLabel=StellarHub がインストールされました。スタート メニューからいつでも開けます。
russian.WelcomeLabel1=Добро пожаловать в StellarHub
russian.WelcomeLabel2=Мастер установит [name/ver] на ваш компьютер.%n%nStellarHub показывает состояние оборудования в реальном времени и помогает управлять драйверами, приложениями и дисковым пространством, очищать файлы и проверять оборудование.
russian.FinishedHeadingLabel=StellarHub готов к работе
russian.FinishedLabelNoIcons=StellarHub установлен.
russian.FinishedLabel=StellarHub установлен. Его можно открыть в меню «Пуск».

[CustomMessages]
english.AppTagline=The control center for your Windows PC
english.InfoInstalls=Installs StellarHub. If Windows does not have the Microsoft Edge WebView2 Runtime yet, it is downloaded from Microsoft and installed too.
english.InfoRequires=Requires Windows 10 (version 1809) or later, 64-bit.
english.InfoFree=Free and open source under the GNU GPL v3. No ads, no account.
english.LinkGitHub=StellarHub on GitHub
english.OptionsTitle=Choose your options
english.OptionsDesc=How should StellarHub start? You can change all of this later in Settings.
english.OptDesktop=Add a shortcut to the desktop
english.OptStartup=Open StellarHub when Windows starts
english.OptStartupHint=It waits quietly in the notification area, next to the clock.
english.OptAdmin=Always open as administrator
english.OptAdminHint=Every tool works right away, with no Windows permission prompt each time.
english.OptAdminHintUser=Every tool works right away. Windows asks for your permission each time StellarHub opens.
english.OptWidget=Show the always-on-top widget at startup
english.OptWidgetHint=A small live panel with your PC's vitals, above every window.
english.OptUpdate=Keep StellarHub up to date
english.OptUpdateHint=When it opens, StellarHub checks GitHub for a new version and asks before updating.
english.OptLanguage=App language
english.StatusApplying=Applying your choices...
english.StatusWarm=Preparing StellarHub for its first start...
english.RunWebView=Installing the Microsoft Edge WebView2 Runtime...
english.RunApp=Open StellarHub now
english.RunNotes=See what's new in version %1
english.UninstRemoveData=Also remove your StellarHub settings and scheduled task history?%n%nChoose No to keep them for a future installation.

spanish.AppTagline=El centro de control de tu PC con Windows
spanish.InfoInstalls=Instala StellarHub. Si Windows aún no tiene Microsoft Edge WebView2 Runtime, también lo descarga de Microsoft y lo instala.
spanish.InfoRequires=Requiere Windows 10 (versión 1809) o posterior, de 64 bits.
spanish.InfoFree=Gratis y de código abierto, con licencia GNU GPL v3. Sin anuncios ni cuentas.
spanish.LinkGitHub=StellarHub en GitHub
spanish.OptionsTitle=Elige tus opciones
spanish.OptionsDesc=¿Cómo quieres que se inicie StellarHub? Puedes cambiar todo esto más adelante en Ajustes.
spanish.OptDesktop=Crear un acceso directo en el escritorio
spanish.OptStartup=Abrir StellarHub al iniciar Windows
spanish.OptStartupHint=Espera en segundo plano en el área de notificación, junto al reloj.
spanish.OptAdmin=Abrir siempre como administrador
spanish.OptAdminHint=Todas las herramientas funcionan al instante, sin que Windows pida permiso cada vez.
spanish.OptAdminHintUser=Todas las herramientas funcionan al instante. Windows te pedirá permiso cada vez que se abra StellarHub.
spanish.OptWidget=Mostrar el widget siempre visible al iniciar
spanish.OptWidgetHint=Un pequeño panel en vivo con los signos vitales de tu PC, por encima de todas las ventanas.
spanish.OptUpdate=Mantener StellarHub al día
spanish.OptUpdateHint=Al abrirse, StellarHub busca una versión nueva en GitHub y pregunta antes de actualizar.
spanish.OptLanguage=Idioma de la aplicación
spanish.StatusApplying=Aplicando tus preferencias...
spanish.StatusWarm=Preparando StellarHub para su primer inicio...
spanish.RunWebView=Instalando Microsoft Edge WebView2 Runtime...
spanish.RunApp=Abrir StellarHub ahora
spanish.RunNotes=Ver las novedades de la versión %1
spanish.UninstRemoveData=¿Eliminar también tu configuración de StellarHub y el historial de las tareas programadas?%n%nElige No para conservarlos para una futura instalación.

portuguese.AppTagline=A central de controle do seu PC com Windows
portuguese.InfoInstalls=Instala o StellarHub. Se o Windows ainda não tiver o Microsoft Edge WebView2 Runtime, ele também é baixado da Microsoft e instalado.
portuguese.InfoRequires=Requer o Windows 10 (versão 1809) ou posterior, de 64 bits.
portuguese.InfoFree=Gratuito e de código aberto, sob a licença GNU GPL v3. Sem anúncios e sem conta.
portuguese.LinkGitHub=StellarHub no GitHub
portuguese.OptionsTitle=Escolha suas opções
portuguese.OptionsDesc=Como o StellarHub deve iniciar? Você pode mudar tudo isso depois em Configurações.
portuguese.OptDesktop=Criar um atalho na área de trabalho
portuguese.OptStartup=Abrir o StellarHub quando o Windows iniciar
portuguese.OptStartupHint=Ele fica discreto na área de notificação, ao lado do relógio.
portuguese.OptAdmin=Sempre abrir como administrador
portuguese.OptAdminHint=Todas as ferramentas funcionam na hora, sem o Windows pedir permissão a cada vez.
portuguese.OptAdminHintUser=Todas as ferramentas funcionam na hora. O Windows pedirá sua permissão sempre que o StellarHub for aberto.
portuguese.OptWidget=Mostrar o widget sempre visível ao iniciar
portuguese.OptWidgetHint=Um pequeno painel ao vivo com os sinais vitais do seu PC, acima de todas as janelas.
portuguese.OptUpdate=Manter o StellarHub atualizado
portuguese.OptUpdateHint=Ao abrir, o StellarHub procura uma versão nova no GitHub e pergunta antes de atualizar.
portuguese.OptLanguage=Idioma do aplicativo
portuguese.StatusApplying=Aplicando suas escolhas...
portuguese.StatusWarm=Preparando o StellarHub para a primeira inicialização...
portuguese.RunWebView=Instalando o Microsoft Edge WebView2 Runtime...
portuguese.RunApp=Abrir o StellarHub agora
portuguese.RunNotes=Ver as novidades da versão %1
portuguese.UninstRemoveData=Remover também as suas configurações do StellarHub e o histórico das tarefas agendadas?%n%nEscolha Não para mantê-los para uma instalação futura.

italian.AppTagline=Il centro di controllo del tuo PC Windows
italian.InfoInstalls=Installa StellarHub. Se Windows non ha ancora Microsoft Edge WebView2 Runtime, viene scaricato da Microsoft e installato.
italian.InfoRequires=Richiede Windows 10 (versione 1809) o successivo, a 64 bit.
italian.InfoFree=Gratuito e open source, con licenza GNU GPL v3. Niente pubblicità, nessun account.
italian.LinkGitHub=StellarHub su GitHub
italian.OptionsTitle=Scegli le tue opzioni
italian.OptionsDesc=Come deve avviarsi StellarHub? Potrai modificare tutto in seguito dalle Impostazioni.
italian.OptDesktop=Crea un collegamento sul desktop
italian.OptStartup=Apri StellarHub all'avvio di Windows
italian.OptStartupHint=Resta in attesa nell'area di notifica, accanto all'orologio.
italian.OptAdmin=Apri sempre come amministratore
italian.OptAdminHint=Tutti gli strumenti funzionano subito, senza che Windows chieda l'autorizzazione ogni volta.
italian.OptAdminHintUser=Tutti gli strumenti funzionano subito. Windows chiederà l'autorizzazione ogni volta che StellarHub si apre.
italian.OptWidget=Mostra il widget sempre in primo piano all'avvio
italian.OptWidgetHint=Un piccolo pannello dal vivo con i parametri vitali del tuo PC, sopra tutte le finestre.
italian.OptUpdate=Mantieni StellarHub aggiornato
italian.OptUpdateHint=All'apertura, StellarHub cerca una nuova versione su GitHub e chiede prima di aggiornare.
italian.OptLanguage=Lingua dell'app
italian.StatusApplying=Applicazione delle tue scelte...
italian.StatusWarm=Preparazione di StellarHub per il primo avvio...
italian.RunWebView=Installazione di Microsoft Edge WebView2 Runtime...
italian.RunApp=Apri StellarHub ora
italian.RunNotes=Scopri le novità della versione %1
italian.UninstRemoveData=Vuoi rimuovere anche le impostazioni di StellarHub e la cronologia delle attività pianificate?%n%nScegli No per conservarle per una futura installazione.

french.AppTagline=Le centre de contrôle de votre PC Windows
french.InfoInstalls=Installe StellarHub. Si Windows n'a pas encore Microsoft Edge WebView2 Runtime, il est aussi téléchargé depuis Microsoft et installé.
french.InfoRequires=Nécessite Windows 10 (version 1809) ou ultérieur, 64 bits.
french.InfoFree=Gratuit et open source, sous licence GNU GPL v3. Sans publicité, sans compte.
french.LinkGitHub=StellarHub sur GitHub
french.OptionsTitle=Choisissez vos options
french.OptionsDesc=Comment StellarHub doit-il démarrer ? Vous pourrez tout modifier plus tard dans les Paramètres.
french.OptDesktop=Créer un raccourci sur le bureau
french.OptStartup=Ouvrir StellarHub au démarrage de Windows
french.OptStartupHint=Il attend discrètement dans la zone de notification, près de l'horloge.
french.OptAdmin=Toujours ouvrir en tant qu'administrateur
french.OptAdminHint=Tous les outils fonctionnent immédiatement, sans demande d'autorisation de Windows à chaque fois.
french.OptAdminHintUser=Tous les outils fonctionnent immédiatement. Windows demandera votre autorisation à chaque ouverture de StellarHub.
french.OptWidget=Afficher le widget toujours visible au démarrage
french.OptWidgetHint=Un petit panneau en direct avec les signes vitaux de votre PC, au-dessus de toutes les fenêtres.
french.OptUpdate=Garder StellarHub à jour
french.OptUpdateHint=À l'ouverture, StellarHub cherche une nouvelle version sur GitHub et demande avant de mettre à jour.
french.OptLanguage=Langue de l'application
french.StatusApplying=Application de vos choix...
french.StatusWarm=Préparation de StellarHub pour son premier démarrage...
french.RunWebView=Installation de Microsoft Edge WebView2 Runtime...
french.RunApp=Ouvrir StellarHub maintenant
french.RunNotes=Voir les nouveautés de la version %1
french.UninstRemoveData=Supprimer également vos paramètres StellarHub et l'historique des tâches planifiées ?%n%nChoisissez Non pour les conserver en vue d'une future installation.

chinesesimplified.AppTagline=您的 Windows 电脑控制中心
chinesesimplified.InfoInstalls=安装 StellarHub。如果 Windows 尚未安装 Microsoft Edge WebView2 Runtime，也会从 Microsoft 下载并安装。
chinesesimplified.InfoRequires=需要 64 位 Windows 10（版本 1809）或更高版本。
chinesesimplified.InfoFree=免费开源，采用 GNU GPL v3 许可证。无广告，无需账户。
chinesesimplified.LinkGitHub=GitHub 上的 StellarHub
chinesesimplified.OptionsTitle=选择您的选项
chinesesimplified.OptionsDesc=StellarHub 应如何启动？这些选项之后都可以在“设置”中更改。
chinesesimplified.OptDesktop=创建桌面快捷方式
chinesesimplified.OptStartup=Windows 启动时打开 StellarHub
chinesesimplified.OptStartupHint=它会安静地待在时钟旁边的通知区域中。
chinesesimplified.OptAdmin=始终以管理员身份打开
chinesesimplified.OptAdminHint=所有工具即开即用，Windows 不会每次都弹出权限提示。
chinesesimplified.OptAdminHintUser=所有工具即开即用。每次打开 StellarHub 时，Windows 都会请求您的许可。
chinesesimplified.OptWidget=启动时显示置顶小组件
chinesesimplified.OptWidgetHint=一个实时显示电脑状态的小面板，始终位于所有窗口之上。
chinesesimplified.OptUpdate=让 StellarHub 保持最新
chinesesimplified.OptUpdateHint=每次打开时，StellarHub 会在 GitHub 上检查新版本，并在更新前征得你的同意。
chinesesimplified.OptLanguage=应用语言
chinesesimplified.StatusApplying=正在应用您的选择...
chinesesimplified.StatusWarm=正在为 StellarHub 的首次启动做准备...
chinesesimplified.RunWebView=正在安装 Microsoft Edge WebView2 Runtime...
chinesesimplified.RunApp=立即打开 StellarHub
chinesesimplified.RunNotes=查看 %1 版本的新功能
chinesesimplified.UninstRemoveData=是否同时删除 StellarHub 的设置和计划任务历史记录？%n%n选择“否”可将其保留，供以后安装时使用。
japanese.AppTagline=Windows PC のコントロール センター
japanese.InfoInstalls=StellarHub をインストールします。Windows に Microsoft Edge WebView2 Runtime がまだない場合は、Microsoft からダウンロードしてインストールします。
japanese.InfoRequires=Windows 10 (バージョン 1809) 以降の 64 ビット版が必要です。
japanese.InfoFree=GNU GPL v3 ライセンスの無料のオープンソース ソフトウェアです。広告もアカウントもありません。
japanese.LinkGitHub=GitHub の StellarHub
japanese.OptionsTitle=オプションの選択
japanese.OptionsDesc=StellarHub をどのように起動しますか? これらはすべて後から「設定」で変更できます。
japanese.OptDesktop=デスクトップにショートカットを作成する
japanese.OptStartup=Windows の起動時に StellarHub を開く
japanese.OptStartupHint=時計の横にある通知領域で静かに待機します。
japanese.OptAdmin=常に管理者として開く
japanese.OptAdminHint=毎回 Windows の許可を求められることなく、すべてのツールをすぐに使えます。
japanese.OptAdminHintUser=すべてのツールをすぐに使えます。StellarHub を開くたびに Windows が許可を求めます。
japanese.OptWidget=起動時に常に手前に表示されるウィジェットを表示する
japanese.OptWidgetHint=PC の状態をリアルタイムで表示する小さなパネルで、すべてのウィンドウの上に表示されます。
japanese.OptUpdate=StellarHub を最新の状態に保つ
japanese.OptUpdateHint=StellarHub は起動時に GitHub で新しいバージョンを確認し、更新する前に確認します。
japanese.OptLanguage=アプリの言語
japanese.StatusApplying=選択内容を適用しています...
japanese.StatusWarm=StellarHub の初回起動を準備しています...
japanese.RunWebView=Microsoft Edge WebView2 Runtime をインストールしています...
japanese.RunApp=今すぐ StellarHub を開く
japanese.RunNotes=バージョン %1 の新機能を見る
japanese.UninstRemoveData=StellarHub の設定とスケジュールされたタスクの履歴も削除しますか?%n%n今後のインストールのために残す場合は「いいえ」を選んでください。

russian.AppTagline=Центр управления компьютером с Windows
russian.InfoInstalls=Мастер установит StellarHub. Если Microsoft Edge WebView2 Runtime ещё не установлен, мастер скачает его с сайта Microsoft и установит.
russian.InfoRequires=Требуется 64-разрядная Windows 10 версии 1809 или новее.
russian.InfoFree=Бесплатное приложение с открытым исходным кодом под лицензией GNU GPL v3. Без рекламы и регистрации.
russian.LinkGitHub=StellarHub на GitHub
russian.OptionsTitle=Параметры установки
russian.OptionsDesc=Выберите, как будет запускаться StellarHub. Позже эти параметры можно изменить в настройках приложения.
russian.OptDesktop=Создать ярлык на рабочем столе
russian.OptStartup=Запускать StellarHub при входе в Windows
russian.OptStartupHint=Приложение будет работать в фоне, а его значок появится в области уведомлений рядом с часами.
russian.OptAdmin=Всегда запускать от имени администратора
russian.OptAdminHint=Все инструменты будут доступны сразу, без повторных запросов разрешения Windows.
russian.OptAdminHintUser=Все инструменты будут доступны сразу после подтверждения запроса Windows при каждом запуске StellarHub.
russian.OptWidget=Показывать виджет поверх окон при запуске
russian.OptWidgetHint=Компактная панель показывает состояние компьютера в реальном времени поверх остальных окон.
russian.OptUpdate=Проверять обновления StellarHub
russian.OptUpdateHint=При запуске StellarHub проверит наличие новой версии на GitHub и спросит перед обновлением.
russian.OptLanguage=Язык приложения
russian.StatusApplying=Применение выбранных параметров…
russian.StatusWarm=Подготовка StellarHub к первому запуску…
russian.RunWebView=Установка Microsoft Edge WebView2 Runtime…
russian.RunApp=Запустить StellarHub
russian.RunNotes=Что нового в версии %1
russian.UninstRemoveData=Удалить также настройки StellarHub и журнал запланированных задач?%n%nВыберите «Нет», чтобы сохранить их для следующей установки.

[InstallDelete]
; an update replaces the runtime folder completely (the old one is kept as _internal.bak until the new one is in
; place, see CurStepChanged), so no file from an older version is left behind
Type: filesandordirs; Name: "{app}\_internal"
; versions before 1.0.1 kept the uninstaller next to the program
Type: files; Name: "{app}\unins000.exe"
Type: files; Name: "{app}\unins000.dat"

[Files]
Source: "..\build\dist\StellarHub\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion
; the WebView2 bootstrapper comes straight from Microsoft, and only if Windows does not have the runtime yet
Source: "https://go.microsoft.com/fwlink/p/?LinkId=2124703"; DestDir: "{tmp}"; DestName: "MicrosoftEdgeWebview2Setup.exe"; ExternalSize: 2097152; Flags: external download ignoreversion deleteafterinstall; Check: NeedsWebView2

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; AppUserModelID: "StellarHub.App"; Comment: "{cm:AppTagline}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; AppUserModelID: "StellarHub.App"; Comment: "{cm:AppTagline}"; Check: WantDesktopIcon

[Run]
; (an all-users install runs elevated: the bootstrapper is checked and run from a copy in the install folder, where
; only administrators can write, never from the user's %TEMP%; see WebView2SetupTrusted)
Filename: "{code:WebView2Setup}"; Parameters: "/silent /install"; StatusMsg: "{cm:RunWebView}"; Check: NeedsWebView2 and WebView2SetupTrusted; Flags: waituntilterminated
; an update reopens StellarHub right here: the first start of the new files must not pay Windows' first-run scan of
; every library (15-20 s with only the start screen, seen in 2.0.0), so they are loaded once first, as the
; post-install step does for a normal install (whichever runs first, the second pass takes a fraction of a second)
Filename: "{app}\{#AppExe}"; Parameters: "--warm"; StatusMsg: "{cm:StatusWarm}"; Check: IsSelfUpdate; Flags: runhidden waituntilterminated
Filename: "{app}\{#AppExe}"; Check: ReopenAfterUpdate; Flags: nowait runasoriginaluser
Filename: "{app}\{#AppExe}"; Description: "{cm:RunApp}"; Flags: nowait postinstall skipifsilent runasoriginaluser
Filename: "{#AppUrl}/releases/tag/v{#AppVersion}"; Description: "{cm:RunNotes,{#AppVersion}}"; Flags: shellexec nowait postinstall skipifsilent runasoriginaluser unchecked

[UninstallRun]
Filename: "{app}\{#AppExe}"; Parameters: "--quit"; RunOnceId: "CloseStellarHub"; Flags: runhidden waituntilterminated
Filename: "{app}\{#AppExe}"; Parameters: "--uninstall-cleanup"; RunOnceId: "CleanupStellarHub"; Flags: runhidden waituntilterminated

[UninstallDelete]
; what the updater downloaded, and the interface cache (rebuilt on demand); settings are only removed if the user
; says so (see below)
Type: filesandordirs; Name: "{app}\update"
Type: filesandordirs; Name: "{localappdata}\StellarHub\webview"
; the start screen's drawing (kept once per version and scale) and the app's small notes (the single-instance port
; when the usual one was taken, the once-per-version administrator checks, a hidden start, update flags): without
; them the folder below was never empty and stayed behind
Type: filesandordirs; Name: "{localappdata}\StellarHub\splash"
Type: files; Name: "{localappdata}\StellarHub\instance-*.port"
Type: files; Name: "{localappdata}\StellarHub\admin-checks"
Type: files; Name: "{localappdata}\StellarHub\start-hidden"
Type: files; Name: "{localappdata}\StellarHub\update.*"
Type: dirifempty; Name: "{localappdata}\StellarHub"

[Code]
{ a silent install started by the updater has no foreground rights: its progress window would open behind whatever
  the user was looking at. Making it topmost (without taking the focus) keeps it in view for the whole update. }
function SetWindowPos(hWnd, hWndInsertAfter: HWND; X, Y, cx, cy: Integer; uFlags: Cardinal): BOOL;
  external 'SetWindowPos@user32.dll stdcall';

procedure KeepProgressInView;
begin
  if ExpandConstant('{param:SELFUPDATE|}') <> '' then
    SetWindowPos(WizardForm.Handle, HWND(-1), 0, 0, 0, 0, $0001 or $0002 or $0010);  { NOSIZE | NOMOVE | NOACTIVATE }
end;

const
  WebView2Key = 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2Key32 = 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  HintColor = $C3AB9E;  { #9EABC3, the app's muted text (TColor is BGR) }

var
  OptionsPage: TWizardPage;
  DesktopBox, StartupBox, AdminBox, WidgetBox, UpdateBox: TNewCheckBox;
  StartupHint, AdminHint, WidgetHint, UpdateHint: TNewStaticText;
  LangCombo: TNewComboBox;
  { the options as they were when Setup started: on top of existing settings, only what the user changes is applied }
  HadSettings, WasDesktop, WasStartup, WasAdmin, WasWidget, WasUpdate: Boolean;
  { /SELFUPDATE: reached the end of the installation }
  SelfUpdateDone: Boolean;
  { the previous runtime, kept aside while the new one is copied: put back if the installation does not finish }
  AppDirAtInstall: String;
  RuntimeBackedUp, RuntimeInstalled: Boolean;
  WasLang: String;

function BoolArg(B: Boolean): String;
begin
  if B then Result := '1' else Result := '0';
end;

{ ---------- WebView2 ---------- }

function HasWebView2In(Root: Integer; Key: String): Boolean;
var
  V: String;
begin
  Result := RegQueryStringValue(Root, Key, 'pv', V) and (V <> '') and (V <> '0.0.0.0');
end;

{ Microsoft's documented check: the runtime's version under EdgeUpdate, per machine or per user }
function NeedsWebView2: Boolean;
begin
  Result := not (HasWebView2In(HKLM, WebView2Key32) or HasWebView2In(HKLM, WebView2Key) or
                 HasWebView2In(HKCU, WebView2Key));
end;

{ Where the WebView2 bootstrapper runs from. Setup's temporary folder is inside the user's %TEMP%, which any program
  running as the user can change: fine for a per-user install (Setup is not elevated), but an all-users install runs
  elevated, so there it is copied into the update folder of the install folder (Program Files: administrators only)
  and checked and run from that copy. }
function WebView2Setup(Param: String): String;
begin
  if IsAdminInstallMode then
    Result := ExpandConstant('{app}\update\MicrosoftEdgeWebview2Setup.exe')
  else
    Result := ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe');
end;

{ the downloaded bootstrapper only runs if Windows says it is signed by Microsoft. PowerShell gets only its own
  modules (an elevated PowerShell would otherwise look in the user's Documents\WindowsPowerShell\Modules first). }
function WebView2SetupTrusted: Boolean;
var
  F: String;
  Code: Integer;
begin
  F := WebView2Setup('');
  if IsAdminInstallMode then
  begin
    ForceDirectories(ExtractFileDir(F));
    DeleteFile(F);
    if not FileCopy(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), F, False) then
    begin
      Log('Could not copy the WebView2 bootstrapper into the install folder: not running it.');
      Result := False;
      exit;
    end;
  end;
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -Command "$env:PSModulePath = $PSHOME + ''\Modules''; ' +
    'Import-Module ($PSHOME + ''\Modules\Microsoft.PowerShell.Security''); ' +
    '$s = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath ''' + F + '''; ' +
    'if ($s.Status -eq ''Valid'' -and $s.SignerCertificate.Subject -match ''O=Microsoft Corporation'') { exit 0 } else { exit 1 }"',
    '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
  if not Result then
    Log('The downloaded WebView2 bootstrapper is not signed by Microsoft: not running it.');
end;

{ ---------- languages: wizard language <-> the app's language codes ---------- }

function AppLangAt(Index: Integer): String;
begin
  case Index of
    1: Result := 'es';
    2: Result := 'pt';
    3: Result := 'it';
    4: Result := 'fr';
    5: Result := 'zh';
    6: Result := 'ja';
    7: Result := 'ru';
  else
    Result := 'en';
  end;
end;

function AppLangIndex(Code: String): Integer;
var
  I: Integer;
begin
  Result := -1;
  Code := Lowercase(Copy(Trim(Code), 1, 2));
  for I := 0 to 7 do
    if AppLangAt(I) = Code then
      Result := I;
end;

function AppLangOf(WizardLanguage: String): String;
begin
  if WizardLanguage = 'spanish' then Result := 'es'
  else if WizardLanguage = 'portuguese' then Result := 'pt'
  else if WizardLanguage = 'italian' then Result := 'it'
  else if WizardLanguage = 'french' then Result := 'fr'
  else if WizardLanguage = 'chinesesimplified' then Result := 'zh'
  else if WizardLanguage = 'japanese' then Result := 'ja'
  else if WizardLanguage = 'russian' then Result := 'ru'
  else Result := 'en';
end;

{ ---------- the user's current settings ---------- }

{ The raw value of a top-level key in settings.json (the app writes it with an indent of 2, one key per line):
  'true' / 'false', or a string without its quotes. Empty if the key is not there. }
function SettingValue(const Json, Key: String): String;
var
  P, I: Integer;
  S: String;
begin
  Result := '';
  P := Pos(#10 + '  "' + Key + '":', Json);
  if P = 0 then
    Exit;
  S := Trim(Copy(Json, P + Length(Key) + 6, 80));
  if Copy(S, 1, 1) = '"' then
  begin
    S := Copy(S, 2, 80);
    P := Pos('"', S);
    if P > 0 then
      Result := Copy(S, 1, P - 1);
  end
  else
  begin
    I := 1;
    while (I <= Length(S)) and (Pos(Copy(S, I, 1), ',}' + #13#10#9 + ' ') = 0) do
      I := I + 1;
    Result := Copy(S, 1, I - 1);
  end;
end;

function SettingBool(const Json, Key: String; Default: Boolean): Boolean;
var
  V: String;
begin
  V := SettingValue(Json, Key);
  if V = 'true' then Result := True
  else if V = 'false' then Result := False
  else Result := Default;
end;

{ What the options look like right now: the app's settings if it has any (the user may have changed them in the app
  since the last install), else what was chosen in the previous installation, else the defaults. }
procedure ReadCurrentOptions;
var
  Raw: AnsiString;
  Json: String;
begin
  WasDesktop := FileExists(ExpandConstant('{autodesktop}\{#AppName}.lnk'));
  HadSettings := LoadStringFromFile(ExpandConstant('{userappdata}\StellarHub\settings.json'), Raw);
  if HadSettings then
  begin
    Json := #10 + String(Raw);
    WasStartup := SettingBool(Json, 'startWithWindows', False);
    WasAdmin := SettingBool(Json, 'alwaysAdmin', False);
    WasWidget := SettingBool(Json, 'widgetWasOpen', False);
    WasUpdate := SettingBool(Json, 'autoUpdate', True);
    WasLang := SettingValue(Json, 'language');
    { no language saved (or "auto") means the app follows Windows: offer the language of this wizard }
    if AppLangIndex(WasLang) < 0 then
      WasLang := AppLangOf(ActiveLanguage);
  end
  else
  begin
    WasStartup := GetPreviousData('StartWithWindows', '0') = '1';
    WasAdmin := GetPreviousData('AlwaysAdmin', '0') = '1';
    WasWidget := GetPreviousData('Widget', '0') = '1';
    WasUpdate := GetPreviousData('AutoUpdate', '1') = '1';
    WasLang := GetPreviousData('AppLanguage', AppLangOf(ActiveLanguage));
    if AppLangIndex(WasLang) < 0 then
      WasLang := AppLangOf(ActiveLanguage);
  end;
end;

{ ---------- the options page ---------- }

procedure HintClick(Sender: TObject);
begin
  if Sender = StartupHint then StartupBox.Checked := not StartupBox.Checked
  else if Sender = AdminHint then AdminBox.Checked := not AdminBox.Checked
  else if Sender = WidgetHint then WidgetBox.Checked := not WidgetBox.Checked
  else if Sender = UpdateHint then UpdateBox.Checked := not UpdateBox.Checked;
end;

function AddOption(const Caption, Hint: String; Checked: Boolean; var Top: Integer;
                   var HintLabel: TNewStaticText): TNewCheckBox;
begin
  Result := TNewCheckBox.Create(OptionsPage);
  Result.Parent := OptionsPage.Surface;
  Result.Left := 0;
  Result.Top := Top;
  Result.Width := OptionsPage.SurfaceWidth;
  Result.Height := ScaleY(19);
  Result.Caption := Caption;
  Result.Checked := Checked;
  Top := Top + Result.Height;
  HintLabel := nil;
  if Hint <> '' then
  begin
    HintLabel := TNewStaticText.Create(OptionsPage);
    HintLabel.Parent := OptionsPage.Surface;
    HintLabel.AutoSize := False;
    HintLabel.WordWrap := True;
    HintLabel.Left := ScaleX(21);
    HintLabel.Top := Top;
    HintLabel.Width := OptionsPage.SurfaceWidth - HintLabel.Left;
    HintLabel.Caption := Hint;
    HintLabel.StyleElements := HintLabel.StyleElements - [seFont];
    HintLabel.Font.Color := HintColor;
    HintLabel.OnClick := @HintClick;
    HintLabel.AdjustHeight;
    Top := Top + HintLabel.Height;
  end;
  Top := Top + ScaleY(14);
end;

procedure CreateOptionsPage;
var
  Top: Integer;
  NoHint: TNewStaticText;
  LangLabel: TNewStaticText;
begin
  OptionsPage := CreateCustomPage(wpSelectDir, CustomMessage('OptionsTitle'), CustomMessage('OptionsDesc'));
  Top := ScaleY(4);
  DesktopBox := AddOption(CustomMessage('OptDesktop'), '', WasDesktop, Top, NoHint);
  StartupBox := AddOption(CustomMessage('OptStartup'), CustomMessage('OptStartupHint'), WasStartup, Top, StartupHint);
  { only an all-users install opens as administrator without the Windows prompt (its scheduled task); a per-user
    install asks Windows each time (stellarhub/elevation.py), and the hint must not promise otherwise }
  if IsAdminInstallMode then
    AdminBox := AddOption(CustomMessage('OptAdmin'), CustomMessage('OptAdminHint'), WasAdmin, Top, AdminHint)
  else
    AdminBox := AddOption(CustomMessage('OptAdmin'), CustomMessage('OptAdminHintUser'), WasAdmin, Top, AdminHint);
  WidgetBox := AddOption(CustomMessage('OptWidget'), CustomMessage('OptWidgetHint'), WasWidget, Top, WidgetHint);
  UpdateBox := AddOption(CustomMessage('OptUpdate'), CustomMessage('OptUpdateHint'), WasUpdate, Top, UpdateHint);

  LangLabel := TNewStaticText.Create(OptionsPage);
  LangLabel.Parent := OptionsPage.Surface;
  LangLabel.Caption := CustomMessage('OptLanguage');
  LangLabel.Left := 0;
  LangLabel.Top := Top + ScaleY(4);

  LangCombo := TNewComboBox.Create(OptionsPage);
  LangCombo.Parent := OptionsPage.Surface;
  LangCombo.Style := csDropDownList;
  LangCombo.Left := LangLabel.Left + LangLabel.Width + ScaleX(12);
  LangCombo.Top := Top;
  LangCombo.Width := ScaleX(190);
  { each language in its own name, so it can be found whatever language the wizard is in }
  LangCombo.Items.Add('English');
  LangCombo.Items.Add('Español');
  LangCombo.Items.Add('Português (Brasil)');
  LangCombo.Items.Add('Italiano');
  LangCombo.Items.Add('Français');
  LangCombo.Items.Add('简体中文');
  LangCombo.Items.Add('日本語');
  LangCombo.Items.Add('Русский');
  LangCombo.ItemIndex := AppLangIndex(WasLang);
  LangLabel.FocusControl := LangCombo;
end;

{ /OPTIONS=desktop,startup,admin,widget and /APPLANG=xx set the options from the command line (silent installs) }
procedure ApplyCommandLine;
var
  Opts, L: String;
begin
  Opts := ExpandConstant('{param:OPTIONS|?}');
  if Opts <> '?' then
  begin
    Opts := ',' + Lowercase(Opts) + ',';
    DesktopBox.Checked := Pos(',desktop,', Opts) > 0;
    StartupBox.Checked := Pos(',startup,', Opts) > 0;
    AdminBox.Checked := Pos(',admin,', Opts) > 0;
    WidgetBox.Checked := Pos(',widget,', Opts) > 0;
    UpdateBox.Checked := Pos(',updates,', Opts) > 0;
  end;
  L := ExpandConstant('{param:APPLANG|}');
  if AppLangIndex(L) >= 0 then
    LangCombo.ItemIndex := AppLangIndex(L);
end;

{ ---------- the welcome page: what gets installed, what it needs, where it lives ---------- }

procedure LinkClick(Sender: TObject; const Link: String; LinkType: TSysLinkType);
var
  Code: Integer;
begin
  ShellExecAsOriginalUser('open', '{#AppUrl}', '', '', SW_SHOWNORMAL, ewNoWait, Code);
end;

function AddWelcomeLine(const Text: String; Top: Integer): TNewStaticText;
begin
  Result := TNewStaticText.Create(WizardForm);
  Result.Parent := WizardForm.WelcomePage;
  Result.AutoSize := False;
  Result.WordWrap := True;
  Result.Left := WizardForm.WelcomeLabel2.Left;
  Result.Top := Top;
  Result.Width := WizardForm.WelcomeLabel2.Width;
  Result.Caption := Text;
  Result.StyleElements := Result.StyleElements - [seFont];
  Result.Font.Color := HintColor;
  Result.AdjustHeight;
end;

procedure DecorateWelcomePage;
var
  Top: Integer;
  Link: TNewLinkLabel;
begin
  { ClickNext is blank, so the text ends in empty lines: drop them before measuring }
  WizardForm.WelcomeLabel2.Caption := TrimRight(WizardForm.WelcomeLabel2.Caption);
  WizardForm.WelcomeLabel2.AdjustHeight;
  Top := WizardForm.WelcomeLabel2.Top + WizardForm.WelcomeLabel2.Height + ScaleY(18);
  Top := Top + AddWelcomeLine(CustomMessage('InfoInstalls'), Top).Height + ScaleY(8);
  Top := Top + AddWelcomeLine(CustomMessage('InfoRequires'), Top).Height + ScaleY(8);
  Top := Top + AddWelcomeLine(CustomMessage('InfoFree'), Top).Height + ScaleY(14);
  Link := TNewLinkLabel.Create(WizardForm);
  Link.Parent := WizardForm.WelcomePage;
  Link.AutoSize := False;
  Link.Left := WizardForm.WelcomeLabel2.Left;
  Link.Top := Top;
  Link.Width := WizardForm.WelcomeLabel2.Width;
  Link.Caption := '<a id="github">' + CustomMessage('LinkGitHub') + '</a>';
  Link.UseVisualStyle := HighContrastActive;
  Link.OnLinkClick := @LinkClick;
  Link.AdjustHeight;
end;

{ ---------- wizard events ---------- }

procedure InitializeWizard;
begin
  ReadCurrentOptions;
  CreateOptionsPage;
  ApplyCommandLine;
  DecorateWelcomePage;
end;

procedure RegisterPreviousData(PreviousDataKey: Integer);
begin
  SetPreviousData(PreviousDataKey, 'StartWithWindows', BoolArg(StartupBox.Checked));
  SetPreviousData(PreviousDataKey, 'AlwaysAdmin', BoolArg(AdminBox.Checked));
  SetPreviousData(PreviousDataKey, 'Widget', BoolArg(WidgetBox.Checked));
  SetPreviousData(PreviousDataKey, 'AutoUpdate', BoolArg(UpdateBox.Checked));
  SetPreviousData(PreviousDataKey, 'AppLanguage', AppLangAt(LangCombo.ItemIndex));
end;

{ run by StellarHub's own updater (/SELFUPDATE): it opens the app again as soon as Setup is done }
function IsSelfUpdate: Boolean;
begin
  Result := ExpandConstant('{param:SELFUPDATE|}') <> '';
end;

{ an elevated updater passes /NOREOPEN=1: from an elevated Setup, runasoriginaluser does nothing, so the app would
  open elevated (or as the administrator who answered the prompt); the reopener StellarHub left, which runs as the
  user, opens it instead }
function ReopenAfterUpdate: Boolean;
begin
  Result := IsSelfUpdate and (ExpandConstant('{param:NOREOPEN|}') = '');
end;

function WantDesktopIcon: Boolean;
begin
  Result := DesktopBox.Checked;
end;

{ the ready page is skipped, so the options page is the last step before installing: say so on the button }
procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = OptionsPage.ID then
    WizardForm.NextButton.Caption := SetupMessage(msgButtonInstall);
end;

{ before copying files, politely ask a running StellarHub to close (it saves its settings on the way out) }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
  Exe: String;
begin
  Result := '';
  KeepProgressInView;
  Exe := ExpandConstant('{app}\{#AppExe}');
  if FileExists(Exe) then
    Exec(Exe, '--quit', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

{ After the files are in place: hand the choices to the app itself. --setup writes them into the settings of the user
  who runs Setup (so it runs as that user, not elevated); --admin-task creates or removes the scheduled task that
  opens StellarHub as administrator without the Windows prompt (that one needs Setup's administrator rights). }
procedure ApplyOptions;
var
  Exe, Args, Lang: String;
  Code: Integer;
begin
  Exe := ExpandConstant('{app}\{#AppExe}');
  Lang := AppLangAt(LangCombo.ItemIndex);
  Args := '';
  if not HadSettings or (Lang <> WasLang) then
    Args := Args + ' language=' + Lang;
  if not HadSettings or (StartupBox.Checked <> WasStartup) then
    Args := Args + ' startWithWindows=' + BoolArg(StartupBox.Checked);
  if not HadSettings or (AdminBox.Checked <> WasAdmin) then
    Args := Args + ' alwaysAdmin=' + BoolArg(AdminBox.Checked);
  if not HadSettings or (WidgetBox.Checked <> WasWidget) then
    Args := Args + ' widgetWasOpen=' + BoolArg(WidgetBox.Checked);
  if not HadSettings or (UpdateBox.Checked <> WasUpdate) then
    Args := Args + ' autoUpdate=' + BoolArg(UpdateBox.Checked);
  if Args <> '' then
  begin
    WizardForm.StatusLabel.Caption := CustomMessage('StatusApplying');
    Log('Applying the options:' + Args);
    if not ExecAsOriginalUser(Exe, '--setup' + Args, '', SW_HIDE, ewWaitUntilTerminated, Code) then
      Log('Could not apply the options: ' + SysErrorMessage(Code))
    else if Code <> 0 then
      Log(Format('Applying the options ended with exit code %d', [Code]));
  end
  else
    Log('The options are unchanged; the settings are left as they are.');

  if AdminBox.Checked <> WasAdmin then
  begin
    if IsAdminInstallMode then
    begin
      if AdminBox.Checked then Args := 'on' else Args := 'off';
      Log('Administrator task: ' + Args);
      Exec(Exe, '--admin-task ' + Args, '', SW_HIDE, ewWaitUntilTerminated, Code);
    end
    else
      Log('Installing for this user only: no administrator task (StellarHub asks Windows each time it opens as administrator).');
  end;

  { no scheduled task is made here any more: a per-user install updates itself directly, and an all-users install
    makes its update task the first time the updater runs elevated (stellarhub/engine/selfupdate.py) }

  { Windows scans every new file the first time it runs; doing that here, with the progress window up, keeps the
    first real start from taking 15-20 s with nothing on screen }
  WizardForm.StatusLabel.Caption := CustomMessage('StatusWarm');
  Exec(Exe, '--warm', '', SW_HIDE, ewWaitUntilTerminated, Code);

  if WasDesktop and not DesktopBox.Checked then
    DeleteFile(ExpandConstant('{autodesktop}\{#AppName}.lnk'));
end;

{ /SELFUPDATE=<file>: tell StellarHub's updater how the installation ended }
procedure WriteSelfUpdateState(const St: String);
var
  F: String;
begin
  F := ExpandConstant('{param:SELFUPDATE|}');
  if F <> '' then
    SaveStringToFile(F, '{"st": "' + St + '", "ver": "{#AppVersion}"}', False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  KeepProgressInView;
  if CurStep = ssInstall then
  begin
    { a full disk, a locked file or an antivirus can stop the copy halfway; Inno rolls back the files it copied but
      not [InstallDelete], so the old runtime is moved aside instead of deleted, and comes back if anything fails }
    AppDirAtInstall := ExpandConstant('{app}');
    if DirExists(AppDirAtInstall + '\_internal.bak') then
      DelTree(AppDirAtInstall + '\_internal.bak', True, True, True);
    if DirExists(AppDirAtInstall + '\_internal') then
      RuntimeBackedUp := RenameFile(AppDirAtInstall + '\_internal', AppDirAtInstall + '\_internal.bak');
  end
  else if CurStep = ssPostInstall then
  begin
    RuntimeInstalled := True;
    if RuntimeBackedUp then
      DelTree(AppDirAtInstall + '\_internal.bak', True, True, True);
    ApplyOptions;
  end
  else if CurStep = ssDone then
  begin
    SelfUpdateDone := True;
    WriteSelfUpdateState('done');
  end;
end;

procedure DeinitializeSetup;
var
  Code: Integer;
begin
  if RuntimeBackedUp and not RuntimeInstalled and DirExists(AppDirAtInstall + '\_internal.bak') then
  begin
    Log('The installation did not finish: putting the previous version back.');
    DelTree(AppDirAtInstall + '\_internal', True, True, True);
    RenameFile(AppDirAtInstall + '\_internal.bak', AppDirAtInstall + '\_internal');
  end;
  if not SelfUpdateDone then
  begin
    WriteSelfUpdateState('failed');
    { the installation did not finish: StellarHub (the previous version, put back above) opens again, and says so }
    if ReopenAfterUpdate and FileExists(AppDirAtInstall + '\{#AppExe}') then
      ExecAsOriginalUser(AppDirAtInstall + '\{#AppExe}', '', AppDirAtInstall, SW_SHOWNORMAL, ewNoWait, Code);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Data: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    Data := ExpandConstant('{userappdata}\StellarHub');
    if DirExists(Data) and not UninstallSilent then
      if MsgBox(CustomMessage('UninstRemoveData'), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
        DelTree(Data, True, True, True);
  end;
end;
