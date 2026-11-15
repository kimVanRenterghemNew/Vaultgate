(()=>{var ze="vaultgate.session",Ee=null,Ea=()=>{try{return globalThis.sessionStorage.getItem(ze)??Ee}catch{return Ee}},at=e=>{Ee=e;try{e?globalThis.sessionStorage.setItem(ze,e):globalThis.sessionStorage.removeItem(ze)}catch{}},Ae=0;async function _(e){Ae+=1;try{return await e()}finally{Ae-=1}}var $=()=>at(null);async function tt(e,t,s){let o={},n=Ea();n&&(o["x-csrf-token"]=n),Ae&&(o["x-portal-refresh"]="1"),e!=="GET"&&(o["content-type"]="application/json");let r=await fetch(t,{method:e,headers:o,body:e==="GET"?void 0:JSON.stringify(s??{}),credentials:"same-origin"}),d=Number(r.headers.get("x-lock-in-ms"));return d&&document.dispatchEvent(new CustomEvent("session-active",{detail:{lockInMs:d}})),{res:r,data:await r.json()}}async function Aa(e){try{return(await navigator.credentials.get({publicKey:PublicKeyCredential.parseRequestOptionsFromJSON(e)})).toJSON()}catch(t){throw Object.assign(new Error(t?.message??"touch cancelled"),{code:"STEP_UP_CANCELLED"})}}async function c(e,t,s){let{res:o,data:n}=await tt(e,t,s);if(n?.error?.code==="STEP_UP_REQUIRED"&&({res:o,data:n}=await tt(e,t,{...s,stepUp:await Aa(n.error.stepUp)})),!o.ok)throw Object.assign(new Error(n.error?.message??o.statusText),{code:n.error?.code,status:o.status});return n&&n.csrf&&at(n.csrf),n}var st={portal:{windowWarning:"You opened the portal in an ordinary browser tab: extensions and the shared profile can read what you type. Open it from the tray (Open portal) or with",common:{all:"all",host:"Host",name:"Name",onUse:"On use",passphrase:"Passphrase",secret:"Secret",tool:"Tool",unlock:"Unlock",virtualKey:"Virtual key",waitingForKey:"Waiting for your key…"},duration:{always:"Always","30m":"30 min","1h":"1 hour","4h":"4 hours"},mode:{silent:"silent",notify:"notify",confirm:"confirm every call",silentLong:"Let it through quietly",notifyLong:"Let it through with a notification",confirmLong:"Ask me every call"},header:{noVault:"no vault yet",locked:"vault locked",open:"vault open",openFor:"Locks in {minutes} min",lock:"Lock",logout:"Log out",timerTip:"The portal locks after the time set in Settings without use; tools with a grant keep working. Log out closes the vault. Unlocking is one touch.",lockTip:"Closes the portal.",logoutTip:"Log out of the portal.",session:"Session"},tabs:{activity:"Activity",keys:"Virtual keys",secrets:"Secrets",grants:"Grants",certificates:"Certificates",passkeys:"Authentication",settings:"Settings"},welcome:{promise1:"Your agents use your secrets.",promise2:"They never get them.",pitch:"Vaultgate sits between your AI tools and the internet. It fills in your keys only at the moment a request leaves, and only where you allow it.",tagline:"Runs on your PC. Open source. No subscription.",stepWelcome:"Welcome",stepPasskeys:"Unlock",stepKey:"Virtual key",stepDone:"Done",how1:"Your passkey is the key to the vault",how1Text:"No password to remember and no recovery code to keep safe. A security key, your phone or this PC.",how2:"Every tool gets a virtual key",how2Text:"It works only on this PC and through Vaultgate. If it leaks, you revoke it in one click.",how3:"What isn't allowed doesn't go through",how3Text:"Every decision has a name and lands in your log. So does everything that was stopped.",start:"Get started",keysTitle:"How do you want to unlock your vault?",keysIntro:"One touch opens it. No password to remember.",keyTitle:"Connect your first tool",skip:"Skip for now",next:"Continue",doneTitle:"Ready to start!",finish:"Open the portal",duration:"Takes about two minutes.",back:"Back",keyIntro:"The tool gets a virtual key of its own. Your real secrets stay in the vault.",wayBest:"best",paired:"{name} is paired and has its own virtual key.",manualHelp:"For tools where you can only fill in a proxy address and an API key. You see the key once; it then lives in the tool's settings, only works through Vaultgate, and you can revoke it anytime.",donePasskeys:"{count} passkeys open the vault",doneTools:"Connected with their own virtual key: {names}",doneNoTools:"No tool connected yet. You can do that later under Virtual keys.",doneEncrypted:"Everything is encrypted on this PC, also names and the log",doneNext:"Next, whenever you like",nextSecret:"Add your first secret",nextSecretText:"an API key, shown once and then never again",nextGrant:"Grant it to a tool",nextGrantText:"or approve it from the tray on first use",donePasskeysOne:"1 passkey opens the vault",twoKeysTitle:"Add at least two.",twoKeysText:"Then one lost key is not a lost vault.",vaultCreated:"Vault created with your first key.",pathTitle:"Every request's path",pathTool:"your tool",pathDomain:"domain"},login:{title:"Sign in",passkeyText:"Touch your passkey. It also opens the vault.",go:"Sign in with passkey",bootstrapText:"No passkey is registered yet. Unlock with your passphrase to register one.",lost:"Lost your passkeys and your passphrase?",recoveryCode:"Recovery code",newPassphrase:"New passphrase",recover:"Recover",startOver:"Lost all your keys? Then you start over with a new vault; your secrets are still with their source."},unlock:{title:"The vault is locked",passkeyText:"It locks itself after a while without use. Touch your passkey to open it again.",passkeyGo:"Unlock with passkey",passphraseText:"Or unlock with your passphrase (for example when your passkey has no PRF).",phoneGo:"Use my phone instead (scan QR)"},recovery:{title:"Your recovery code",text:"Keep this code on paper or in another vault. You see it only now, once. If you lose your passkeys and your passphrase, only this code still opens the vault.",confirm:"Type the last 4 characters to confirm",done:"I have stored it"},main:{noPasskey:"No passkey registered yet. Add one under Passkeys: without a passkey you cannot sign in later.",onePasskey:"You have one passkey. Add a second one, so that a lost key is not lost access."},wizard:{title:"Getting started",passkey:"Passkey",key:"Virtual key",secret:"Secret",firstCall:"First call",next:{passkey:"Add your passkey: without one you cannot sign in later.",key:"Create a virtual key for your tool (or pair it with the device flow).",secret:"Add your first secret, with the domain it may go to.",grant:"Let the tool make a first call (approve it in the tray), or add a grant."},go:{passkey:"Go to Passkeys",key:"Go to Virtual keys",secret:"Go to Secrets",grant:"Go to Grants"},checkIntro:"Check, without a real call, which rule a call of this key with this secret would get:",check:"Check",result:{granted:"works: a call goes straight through","needs-approval":"the first call asks for approval in the tray (or add a grant)","tool-key-revoked":"this virtual key has been revoked","unknown-secret":"this secret does not exist","target-host-not-allowed":"the domain is not on the secret's allowlist"}},audit:{title:"Activity",all:"all decisions",allowed:"allowed",stopped:"stopped",decision:"Decision",filter:"Filter",empty:"Nothing here yet.",statAllowed:"let through",statStopped:"stopped",statScrubbed:"caught in responses",latest:"Latest decisions",introNone:"Nothing waits for you. Every decision carries the name of the rule that made it.",introOne:"1 thing waits for you. Every decision carries the name of the rule that made it.",intro:"{count} things wait for you. Every decision carries the name of the rule that made it.",repeat:"Same decision {count} times since {since}.",renew:"Renew grant",createSecret:"Create secret",allowHost:"Allow as new grant",allowPlace:"Allow this place",allowPlaceConfirm:"Also fill in {secret} at {place}? Only do this if the service expects it there.",admin:"changes",via:{portal:"in the portal",tray:"in the tray",device:"by pairing a device",proxy:"by the first allowed call"},noTool:"unknown client",pick:"Pick a decision on the left to see why it was made.",fact:{when:"When",repeat:"Repeated",request:"Request",from:"From",change:"Change",connection:"Connection"}},keys:{newTitle:"New virtual key",kindWeb:"Web requests",kindMcp:"MCP server",otherMachines:"Used from another machine?",clients:"Clients outside this PC (IP or subnet)",create:"Create key",keyTitle:"Your virtual key:",keyOnce:"you see it only now.",configTitle:"Put this in the tool",configAnthropic:"Claude Code and other Anthropic clients",configForward:"Any other API: a placeholder in a header, the virtual key separately",kind:"Kind",domains:"Has access to",noDomains:"nothing yet",thisPcOnly:"this PC only",active:"active",revoked:"revoked",rotate:"Rotate",reactivate:"Reactivate",reactivateConfirm:"Reactivate {name}? Its key and grants work again.",revoke:"Revoke",revokeConfirm:"Revoke {name}? The tool cannot do anything until you reactivate it.",dialogTitleWeb:"Virtual key for web requests",dialogTitleMcp:"Virtual key for an MCP server",copy:"Copy",copied:"Copied",copiedNote:"Copied. After 60 seconds Vaultgate clears the clipboard if the key is still on it. Edge may ask once to allow reading the clipboard. Windows clipboard history (Win+V) keeps its own copy.",gotIt:"Got it",close:"Close",intro:"Every tool gets its own virtual key. If a key leaks, revoke it; your real secrets stay the same.",empty:"No virtual keys yet. Create one, or pair a tool.",waiting:"A tool wants to pair",waitingHelp:"Type the code from your terminal into the pairing request before you allow it.",edit:"Edit",editTitle:"Edit {name}",editName:"Tool name",editOther:"Also from other addresses",editSave:"Save changes",thisPcAnd:"this PC + {list}",rotateConfirm:"Rotate the key of {name}?",rotateWarning:"The old key stops working right away.",rotating:"Rotates automatically",manual:"Manual — doesn't rotate",rotatingHelp:"Each time this tool asks for its key, Vaultgate gives it a token that works for 10 minutes and replaces its stored key with a new one. If an old copy is used, Vaultgate revokes the tool and tells you. It cannot stop a program that runs as you from asking for a token itself.",manualHelp:'This key stays the same until you rotate it: Vaultgate does not change it where you put it (an environment variable or a config file). Pair the tool with "login --name" so its key rotates by itself.',reask:"Ask for my passkey again",reaskOff:"never",reaskHours:"every {hours} h",reaskHelp:"When the tool fetches a new token after this time, Vaultgate asks you to touch your passkey.",tools:"Tools",count:"{count} in total",pick:"Pick a key on the left.",grants:"Grants",created:"set on {date}; shown once, never again",fact:{from:"Calls from",key:"Key"}},secrets:{addTitle:"Add a secret",value:"Value",sensitive:"Sensitive",sensitiveHelp:"Every approval, even a one-time one, asks you to touch your passkey.",add:"Save in the vault",saved:"Secret saved. Its value is not shown again.",sensitiveBadge:"sensitive",legacyInject:"any header (old: please set)",rotate:"Rotate",rotatePrompt:"New value for {name}. Make it at the provider first, then paste it here.",revoke:"Delete",revokeConfirm:"Delete {name}? This cannot be undone.",intro:"Your real keys and logins. Vaultgate fills them into a request as it leaves, only for the domains you allow.",footer:"A value never leaves the vault, except into the request it is meant for. Lost track of one? Rotate it with a new value from the provider.",addIntro:"Vaultgate encrypts it right away. After saving, nobody can read it back, not even you.",kindKey:"API key or token",kindKeyHelp:"one value, like sk-…",kindLogin:"Login",kindLoginHelp:"username and password, optional 2FA",kindService:"Connected service",later:"coming later",username:"Username",password:"Password",kindLoginNote:"Login. Vaultgate fills in the username and password itself.",domain:"Domain",domainHelp:"Only this domain gets the secret. Anything else is stopped.",never:"Shown never again. To change it later, use Rotate.",clipboardNote:"After pasting, clear your clipboard history (Win+V). Vaultgate never shows or returns the value.",rotateWarning:"After pasting, clear your clipboard history (Win+V). The old value stops working right away.",on:"On",recommended:"recommended",editTitle:"Edit {name}",editIntro:"Everything except the value. For a new value, use Rotate.",domains:"Domain and its subdomains",addDomain:"add a subdomain…",removeDomain:"Remove",grantsNone:"no grants yet",grantsOne:"1 grant",grants:"{count} grants",empty:"No secrets yet. Add your first one.",revokeGrants:"Its grants go with it: {list}. The key itself still works at the provider: revoke it there too.",renameWarning:"Tools that ask for {{secret:{old}}} must use the new name. Grants and routes move along.",places:"Filled in at",learning:"not yet known: the first allowed call sets it",placesHelp:"Where the secret goes into a request. Another place is stopped; you can allow it from Activity (at most 3).",vault:"In the vault",figVault:"in the vault",pick:"Pick a secret on the left.",kindKeyNote:"API key or token. Filled into requests to its domains, nowhere else.",touchGrant:"only for a grant, not for every request",touchSensitive:"every approval, even a one-time one",valueSet:"set on {date}; never shown again",fact:{domain:"Domain",subdomains:"Other domains",touch:"Touch"}},grants:{addTitle:"Add a grant",add:"Grant",filterTool:"Filter by virtual key",filterSecret:"Filter by secret",fromTray:"approved in the tray",fromPortal:"added in the portal",expired:"expired",revoke:"Delete",intro:"A grant lets one tool use one secret on one domain. You choose what happens on use, and for how long.",footer:"Without a grant, a call asks you in the tray; no answer means stopped (approval-timeout). Other stopped calls are in Activity, each with its rule.",addIntro:"One tool, one secret, one domain. Or skip this: the first call asks in the tray.",chooseTool:"Choose a tool…",chooseSecret:"Choose a secret…",chooseDomain:"Choose a domain…",validFor:"Valid for",validHelp:"After that it rests; the next call asks you again.",editTitle:"Edit grant",extendBy:"Extend by",keep:"Keep the remaining time",plus30m:"+ 30 min",plus1h:"+ 1 hour",plus4h:"+ 4 hours",leftMin:"{n} min left",leftHours:"{n} h left",renew:"Renew",revokeConfirm:"Delete this grant? {chain}. The next call of this combination asks you again in the tray.",empty:"No grants yet. The first call of a tool asks you in the tray.",allTools:"all virtual keys",allSecrets:"all secrets",temporary:"for now: {mode}; then the rule above applies again",endTemporary:"End now",newDomain:"{host} (new domain for this secret)",allDomains:"All domains of this secret",uses:"uses",pick:"Pick a grant on the left.",noteRunning:"Calls go through until {time}. After that the next call asks you again.",noteAlways:"No end. Delete it here when the tool no longer needs it.",noteExpired:"Expired: the next call asks you in the tray. Renew it to let calls through again.",fact:{origin:"Approved"}},device:{enterCode:"Type the code shown in {name}'s terminal to confirm this pairing.",checkCode:"Check code",client:"From",since:"Since",exists:"already exists: will be refused",rotated:"rotated: enter the code to reconnect",approve:"Approve",deny:"Deny",empty:"No pairing requests waiting.",noTouch:"Not paired: your passkey was not touched.",paired:"Paired: {name} has its key.",pairedEmpty:"No tools paired yet."},passkeys:{intro:"The keys that open your vault. Keep at least two, so one lost key is not a lost vault.",add:"Add a key",securityKey:"Security key",securityKeyHelp:"the strongest: the key does not live in your PC",phone:"Phone",phoneHelp:"scan a QR code, confirm with your fingerprint",thisPc:"This PC (Windows Hello)",thisPcHelp:"quick, but on the same machine as your agents",another:"Another key",recommended:"recommended",anotherHelp:"your phone or a second security key",nothingToKeep:"No password, no recovery code on paper: nothing anyone can steal. If you lose all your keys, you start over; your secrets are still with their source.",unlocks:"opens the vault",noPrf:"signs in, but does not open the vault",remove:"Remove",removeConfirm:'Remove the passkey "{name}"?',registered:"Passkey added. It opens the vault.",registeredNoPrf:"Passkey added, but without PRF: it signs you in, the vault still opens with your other key.",kind:{securityKey:"Security key",phone:"Phone",thisPc:"This PC",unknown:"Passkey"},addTitle:"Add a passkey",opens:"{count} keys open the vault.",opensOne:"1 key opens the vault.",signInOnly:"{count} without PRF only sign you in to review activity: they cannot open the vault.",rename:"Rename",renamePrompt:'A name for this passkey, so you know which key is which (for example "YubiKey keyring"). Empty: the kind.',lastUsed:"last used {date}",yours:"Your passkeys",figOpens:"open the vault",figSigns:"sign in only",vault:"Vault",added:"Added",used:"Last used",prfNote:"Opens the vault: its PRF output unwraps the vault key. Without this key or another one like it, the vault stays closed.",noPrfNote:"Signs you in to review activity, but has no PRF: it cannot open the vault or decrypt a secret."},settings:{title:"Settings",language:"Language",languageSystem:"Same as the system",touch:"Touch with",touchAny:"any passkey",touchExternal:"only an external key",timeout:"Time to answer the tray",autolock:"Lock automatically",listeners:"Other machines",routes:"Extra routes",saved:"Settings saved.",intro:"How Vaultgate asks you, locks itself and listens. Changes take effect on the next request.",auto:"Saved automatically",groupVault:"Vault and approvals",groupLook:"Appearance",groupNetwork:"Network",autolockHelp:"after this long without use",timeoutHelp:"then the request is denied",touchHelp:'for "always", sensitive secrets and pairing',languageHelp:"in this browser",listenersNone:"extra listen addresses: none",listenersIntro:"By default Vaultgate only listens on this PC. Add an address to let tools on other machines in, for example a VM.",listenersWarning:"Virtual keys and secrets travel in plain text across the local network, without TLS. Only listen on private, host-only or trusted network adapters.",listenersLabel:"Listen addresses (ip:port), one per line",listenersHelp:"A virtual key also has to allow the client: Virtual keys, Edit.",routesNone:"none",routesIntro:"A path on Vaultgate that forwards to a host, for tools that only take a base URL. The secret goes into the header you choose.",routeAdd:"Add a route",routeName:"Path name",routeBase:"Forwards to",routeHeader:"Header",groupQuiet:"Quiet hours and notifications",quietHours:"Quiet hours",quietHoursHelp:"every call is stopped, without asking you",quietNone:"none",quietIntro:"During these hours Vaultgate stops every call (rule quiet-hours) and asks nothing in the tray. Local time; a window may cross midnight.",quietLabel:"Windows (HH:MM-HH:MM), one per line",quietHelp:"Removing or changing a window asks for a touch of your passkey.",notifications:"Notifications",notificationsHelp:"for grants that notify; approvals in the tray still ask",theme:"Theme",themeHelp:"dark or light, for this browser",themeSystem:"Same as Windows",themeDark:"Dark (Dracula)",themeLight:"Light (Console)",groupDanger:"Danger zone",deleteVault:"Delete vault",deleteVaultHelp:"Permanently deletes all secrets, tools, and passkeys. This cannot be undone.",deleteVaultConfirm:"Are you sure you want to delete this vault?",deleteVaultWarning:"All secrets and virtual keys will be permanently deleted. You will start over with a new vault.",vaultDeleted:"Vault deleted. You can start over."},tls:{title:"Certificates",subtitle:"Roots that Node and Mozilla trust, and a renewed certificate under a known root, need nothing from you. A new root you do not trust stops every request until you decide here.",guideBtn:"Security guide & warning",reviewBtn:"Review roots on this PC",keepBlocking:"Keep blocking",reviewTrust:"Review & trust…",emptyTrusted:"The roots that Node and Mozilla trust need nothing from you; they are not listed here.",scopeGlobal:"all domains (inspected in Activity)",chainIntact:"chain intact",details:"Details",revoke:"Revoke trust",introTitle:"Before you trust a certificate",introDesc:"Vaultgate guarantees that secrets only travel across verified connections. When a certificate is untrusted or modified, requests stop immediately.",step1Title:"Check the certificate name",step1Desc:"Identify who issued the certificate. Look up the name online or verify it with your company's IT support if you don't recognize it.",step2Title:"Only trust known, authorized software",step2Desc:"Trust it only if it belongs to your organization's inspection proxy (e.g. Zscaler, Fortinet) or your own developer tools (e.g. mkcert, Fiddler). If the source is unknown, never trust it.",inspectionWarnTitle:"Inspection warning:",inspectionWarn:"When you trust a certificate root, the software or entity behind that certificate can read and inspect all your decrypted network traffic, including API requests and responses.",understand:"I understand",trustTitle:"Trust {root}?",trustWarn:"Trusting this root allows {root} to decrypt and read all network traffic and secrets sent through it.",trustInstruction:"Only trust this root if you recognize it as your company's network security proxy or your own tool. Compare the fingerprint with IT or look up the issuer name.",trustScope:"Choose scope:",scopeHostTitle:"Only for {origin}",scopeHostDesc:"Least privilege. Other domains will still ask if they use this root.",scopeGlobalTitle:"For all domains (company proxy)",scopeGlobalDesc:"Recommended for Zscaler/Fortinet. Requests will show an orange inspected badge in Activity.",trustTouch:"Trust with a touch",untrustTitle:"Revoke trust in {root}?",untrustDesc:"Requests through {root} are stopped again, with tls-untrusted.",untrustImmediate:"Restricting trust takes effect immediately and does not require a touch.",untrustConfirm:"Revoke trust",detailsIssuer:"Issuer",detailsFingerprint:"Fingerprint",detailsValid:"Valid",detailsScope:"Scope",reviewRootsTitle:"Roots on this PC",reviewRootsDesc:"Roots in the Windows store that Node and Mozilla do not trust. Vaultgate trusts none of them unless you say so.",noExtraRoots:"No additional roots were found.",titleChanged:"Certificate changed for {origin}",titleUntrusted:"Certificate not trusted for {origin}",text:"Before: {before} · now: {now}. No secret goes there until you trust the new chain. If you did not expect this (for example on another network), do not trust it.",textUntrusted:"Issuer now: {now} · root: {root} · valid to: {validTo}. This root is not trusted yet; no secret goes there until you trust it.",trust:"Trust the new chain",doNotTrust:"Do not trust (recommended)",colBefore:"Before",colNow:"Now",issuer:"Issuer",root:"Root",validTo:"Valid to",fingerprint:"Fingerprint",noEarlier:"none",roots:"Roots",waits:"{count} waiting for you",trusted:"trusted",inspected:"inspected",allDomains:"all domains",trustedAll:"trusted, all domains",trustedOne:"trusted, one domain",globalNote:'It can read what passes through it. Every request it handles shows "inspected" in Activity.',hostNote:"Only for {origin}. Any other domain that ends at this root is stopped.",changedNote:"The chain of {host} now ends at {root}, a root you do not trust. A man in the middle looks exactly like this. Nothing went out: secrets stayed in the vault.",untrustedNote:"{host} ends at {root}, a root you do not trust. Nothing went out: secrets stayed in the vault.",notYours:"Not your company proxy? Keep blocking: do nothing.",requests:"Requests",stopped:"stopped until you decide",trustedAt:"Trusted",chain:"Chain"},ask:{ok:"OK",cancel:"Cancel",show:"Show"},menu:{label:"Main menu",waits:"waits for you"},keyCreate:{nameTitle:"Name the tool",nameHelp:"Shown in your log and in every approval.",kindTitle:"How does it call out?",webHelp:"an agent or script that calls an API",mcpHelp:"Claude Code, Claude Desktop, VS Code",giveTitle:"Give it its key",wayAuto:"Connect automatically",wayAutoHelp:"you never see the key",wayManual:"Copy the key myself",wayManualHelp:"for tools with only a proxy and API key field",pairRun:"a. Run this where the tool lives:",pairCheck:"b. Your terminal shows a code. Check that it is the same here, then allow it.",mcpCreateHelp:"Create the key, then put the configuration in your MCP client. You see the key once."},waiting:{title:"Waiting for you",none:"Nothing waits for you.",pair:"{name} wants to pair",tls:"The certificate of {host} changed",approval:"{tool} asks for {secret} on {host}: answer in the tray",review:"Review",decide:"Decide",check:"Check"},rollback:{title:"This is an older copy of the vault",text:"The vault in this folder is older than the last one opened on this PC. That happens when a backup is restored, but also when someone puts back an old copy to bring back a revoked tool or a removed grant. The vault stays closed until you confirm.",accept:"I restored this backup on purpose: open it anyway"},integrity:{title:"Vaultgate's own files changed",text:'These files of Vaultgate are not the same as when the vault was last opened here. That happens after an update, but also when a program changes Vaultgate, for example so that the tray always answers "allow". The vault stays closed until you confirm.',accept:"I updated or changed Vaultgate myself: open the vault anyway"},pause:{block:"Block",silence:"Silence","15m":"for 15 minutes","1h":"for 1 hour",tomorrow:"until tomorrow",forever:"until I lift it",blockedUntil:"blocked until {time}",blockedForever:"blocked until you lift it",unblock:"Unblock",silencedUntil:"silent until {time}",unsilence:"Notifications on"},specs:{title:"Security",help:"The key hierarchy, the encryption and its parameters, explained on the website.",link:"View the technical security specifications"},mcpInstall:{help:"Put Vaultgate in your agents on this PC with one click. The agent gets the tool's name, never the key; restart the agent afterwards.",none:"No agents found on this PC.",otherAgent:"Another agent or another place?",copyJson:"Copy JSON",copyJsonVscode:"Copy JSON (VS Code)",statusPage:"MCP status page & tools",install:"Install",uninstall:"Uninstall",scopeUser:"All folders (user)",scopeProject:"Specific folder (project)",folderPlaceholder:"Path to project folder (e.g. C:\\git\\my-project)",missing:"no longer found",skillTitle:"Agent skill & policy",skillHelp:"Copies SKILL.md and sets the core policy rule for Claude, Copilot and other agents.",installSkill:"Install skill",uninstallSkill:"Uninstall skill",status:{installed:"Installed",updated:"Updated",unchanged:"Already installed",removed:"Removed",absent:"Not installed",error:"Failed"},whereTitle:"Where",agentsTitle:"Agents on this PC",refresh:"Update",refreshNothing:"Everything is up to date; no file changed.",changedTitle:"Vaultgate changed these files",backupNote:"The old version is in {path}"}},touch:{title:"Touch your passkey",why:"A program can click buttons. It cannot touch your passkey.",deny:"Cancel and deny",confirm:"Touch to confirm",gone:"This question no longer exists (expired or already answered).",question:{always:"{tool} wants to use {secret} on {host} from now on.",sensitive:"{tool} wants to use the sensitive secret {secret} on {host}.",device:"{tool} wants to be paired and get its own key.",reask:"{tool} wants a new token. You asked Vaultgate to check with you every few hours."},code:"Code",request:"Request",denied:"Denied. You can close this window.",confirmed:"Confirmed. You can close this window.",failed:"Not confirmed: no valid touch. The question was denied.",codeHint:"Code {code} matches your terminal. Touch your passkey to confirm.",close:"Close window",pairTitle:"Pair {tool}?",confirmedTitle:"Confirmed",deniedTitle:"Denied",goneTitle:"Nothing to confirm",closeHint:"Window still open? Close it with Alt+F4."},rules:{fallback:{allow:"{tool} used {secret} on {host}.",deny:"{tool} was stopped; nothing was decrypted.",admin:"A setting was changed."},granted:"{tool} used {secret} on {host}.","approved-once":"{tool} used {secret} on {host}, approved once.","approved-always":"{tool} used {secret} on {host}; you allowed it from now on.","approved-30m":"{tool} used {secret} on {host}; allowed for 30 minutes.","approved-1h":"{tool} used {secret} on {host}; allowed for 1 hour.","approved-4h":"{tool} used {secret} on {host}; allowed for 4 hours.","target-host-not-allowed":"{tool} wanted to send {secret} to {host}. Stopped; nothing was decrypted.","no-tool-key":"A call without a valid virtual key. Stopped.","tool-key-revoked":"{tool} used a revoked key. Stopped.","client-not-allowed":"{tool} called from a machine that is not allowed. Stopped.","no-placeholder":"{tool} made a call without a secret placeholder. Stopped.","unknown-secret":"{tool} asked for {secret}, which does not exist. Stopped.","placeholder-location-not-allowed":"{tool} put {secret} where it may not go. Stopped.","bad-target":"{tool} asked for {secret} on {host} with an encoded character in the path (such as %2f), which could slip past the allowed path. Stopped; nothing was decrypted.","grant-expired":"The grant of {tool} for {secret} has expired; asked again.","approval-denied":"You denied {tool} using {secret} on {host}.","approval-timeout":"Nobody answered in time for {tool} → {secret} → {host}. Denied.","approval-unavailable":"{tool} needed an approval, but the tray was not running. Denied.","touch-denied":"Your passkey was not touched for {tool} → {secret}. Denied.","touch-timeout":"No passkey touch in time for {tool} → {secret}. Denied.","vault-locked":"The vault was locked; nothing was decrypted.",throttled:"Too many wrong attempts; this caller waits before it gets an answer.","tls-chain-changed":"Another certificate chain for {host}. Nothing is sent until you decide.","tls-chain-accepted":"You trusted the new certificate chain for {host}.","audit-unavailable":"The log could not be written, so nothing was sent.","device-requested":"{tool} asked to be paired.","device-approved":"You paired {tool}.","device-delivered":"{tool} received its key.","device-expired":"The pairing request of {tool} expired.","device-name-taken":"{tool} asked for a name that already exists. Refused.","tunnel-not-supported":"A tunnel to {host} was refused: Vaultgate cannot fill in or check it.","response-scrubbed":"{host} sent {secret} back in its response; Vaultgate removed it before {tool} saw it.","subdomain-denied":"{tool} asked for {secret} on {host}, a new subdomain; it was not added. Stopped; nothing was decrypted.","secret-added":"Secret {secret} was added.","secret-rotated":"The value of {secret} was replaced.","secret-hosts-changed":"The domains of {secret} were changed.","secret-places-changed":"Where {secret} may be filled in was changed.","secret-sensitive-changed":"Sensitive was changed for {secret}.","secret-renamed":"A secret was renamed to {secret}.","secret-removed":"Secret {secret} was deleted, with its grants.","tool-added":"Virtual key {tool} was created.","tool-renamed":"A virtual key was renamed to {tool}.","tool-clients-changed":"The machines that may use {tool} were changed.","tool-defaults-changed":"The defaults of {tool} were changed.","tool-key-rotated":"{tool} got a new key; the old one stopped working.","tool-key-repaired":"{tool} was paired again and got a new key.","tool-revoked":"{tool} was revoked.","tool-reactivated":"{tool} was reactivated.","tool-removed":"Virtual key {tool} was deleted, with its grants.","grant-added":"{tool} may now use {secret} on {host}.","grant-changed":"The grant of {tool} for {secret} on {host} was changed.","grant-removed":"{tool} may no longer use {secret} on {host}.","new-passkey-added":"A passkey was added to the vault.","passkey-renamed":"A passkey got a new name.","passkey-removed":"A passkey was removed from the vault.","passkey-prf-enrolled":"A passkey can now open the vault.","settings-changed":"The settings were changed.","step-up-confirmed":"A change was confirmed with a touch of your passkey.","vault-recovered":"The vault was recovered with the recovery code; there is a new passphrase.","tool-blocked":"{tool} was blocked.","tool-unblocked":"{tool} was unblocked.","secret-blocked":"{secret} was blocked.","secret-unblocked":"{secret} was unblocked.","grant-blocked":"The grant of {tool} for {secret} on {host} was blocked.","grant-unblocked":"The grant of {tool} for {secret} on {host} was unblocked.","passkey-blocked":"A passkey was blocked.","passkey-unblocked":"A passkey was unblocked.","notifications-snoozed":"Notifications were snoozed.","grant-notifications-snoozed":"Notifications for one grant were snoozed.","tls-untrusted-accepted":"You trusted the certificate root for {host}.","quiet-hours":"{tool} asked for {secret} on {host} during quiet hours. Stopped; nothing was decrypted.","notifications-resumed":"Notifications are on again.","grant-notifications-resumed":"Notifications for one grant are on again."},tray:{popup:{title:{approve:"Vaultgate: approval",device:"Vaultgate: pair tool",tunnel:"Vaultgate: TUNNEL"},header:{approve:"New combination: allow?",device:"A tool asks for a key: pair?",tunnel:"Tunnel without fill-in and without scrubbing: security risk",subdomain:"A new subdomain: add it to this secret?"},field:{tool:"Tool",secret:"Secret",host:"Host",request:"Request",client:"Client"},new:"(new)",typeCode:"Type the code from your terminal into the pairing request in the Vaultgate portal first; only then can you allow it here.",sensitive:"Sensitive: touch your passkey after this.",allowTimed:'"Allow" for a time: touch your passkey after this.',button:{deny:"Deny",once:"Once",allow:"Allow",always:"Always"},span:{"30m":"30 min","1h":"1 hour","4h":"4 hours",always:"always"},countdown:"expires in {seconds} s",arming:"(buttons active after 1.5 s)  ",timedOut:"expired: nothing allowed",invalidHost:"(invalid host)",root:{same:"Same certificate root as the domain you allowed (a hint, not a guarantee).",different:"A different certificate root than the domain you allowed: be careful.",unknown:"The certificate root could not be checked."}},menu:{tooltip:{locked:"vault closed",unlocked:"vault open",pending:"({count} pending)"},vault:{locked:"Vault: closed",unlocked:"Vault: open"},pending:"Pending approvals ({count})",lockNow:"Lock now",logout:"Log out (close vault)",openPortal:"Open portal",disabledSuffix:" [disabled]"},notify:{codeChanged:{title:"Vaultgate: files changed",text:"The vault stays closed: {files} changed. Check the portal."},delayed:{title:"Vaultgate: delayed",text:"Repeated failed attempts ({actor}): no answer for {seconds} s."},used:{title:"Vaultgate: used",text:"{tool} used {secret} for {host}"},actor:{tool:"tool {tool}",client:"from {client}"},passkeyAdded:{title:"Vaultgate: new passkey",text:"A new passkey was added to your vault. Not you? Remove it under Passkeys."},reuse:{title:"Vaultgate: copied key detected",text:"Someone used an old key of {tool}. Vaultgate revoked the tool. Rotate its key in the portal and pair it again."},admin:{title:{portal:"Vaultgate: changed in the portal",tray:"Vaultgate: changed from the tray",device:"Vaultgate: changed by a paired tool",proxy:"Vaultgate: learned by the proxy",other:"Vaultgate: changed"},more:"{count} more changes like this: {text}",rules:{other:"A change in your vault ({rule}).","secret-added":"Secret {secret} added.","secret-rotated":"The value of secret {secret} was replaced.","secret-hosts-changed":"The domains of secret {secret} changed.","secret-places-changed":"Where secret {secret} may go in a request changed.","secret-sensitive-changed":'Secret {secret}: "sensitive" changed.',"secret-renamed":"A secret was renamed to {secret}.","secret-removed":"Secret {secret} removed.","tool-added":"New virtual key: {tool}.","tool-renamed":"A virtual key was renamed to {tool}.","tool-clients-changed":"The addresses of {tool} changed.","tool-defaults-changed":"The defaults of {tool} changed.","tool-reask-changed":"How often {tool} asks for your passkey changed.","tool-key-rotated":"The key of {tool} was rotated.","tool-key-repaired":"{tool} was paired again and got a new key.","tool-revoked":"{tool} was revoked.","tool-reactivated":"{tool} was reactivated.","tool-removed":"{tool} removed.","key-rotated":"{tool} got a new key automatically. You do not need to do anything.","grant-added":"New grant: {tool} may use {secret} on {host}.","grant-changed":"Grant changed: {tool}, {secret} on {host}.","grant-removed":"Grant removed: {tool}, {secret} on {host}.","passkey-renamed":"A passkey was renamed.","passkey-removed":"A passkey was removed.","new-passkey-added":"A new passkey was added.","passkey-prf-enrolled":"A passkey can now open the vault.","settings-changed":"Settings changed.","tool-blocked":"A virtual key was blocked.","tool-unblocked":"A virtual key was unblocked.","secret-blocked":"Secret {secret} was blocked.","secret-unblocked":"Secret {secret} was unblocked.","grant-blocked":"A grant for {secret} on {host} was blocked.","grant-unblocked":"A grant for {secret} on {host} was unblocked.","passkey-blocked":"A passkey was blocked.","passkey-unblocked":"A passkey was unblocked.","notifications-snoozed":"Notifications paused.","notifications-resumed":"Notifications are on again.","grant-notifications-snoozed":"Notifications for a grant paused.","grant-notifications-resumed":"Notifications for a grant are on again.","vault-recovered":"The vault was opened with the recovery code.","tls-chain-accepted":"A new certificate chain for {host} is trusted.","tls-untrusted-accepted":"A new certificate root for {host} is trusted."}}}},cli:{login:{pairing:'Pairing "{name}" with Vaultgate.',checkCode:`Your code: {code}
Open the Vaultgate portal, type this code into the pairing request, then allow it and touch your passkey.`,waiting:"Waiting until you allow it in Vaultgate...",requestFailed:"Vaultgate refused the request: {error}",badResponse:"Vaultgate: unexpected answer (tool name or key)",pollError:"Vaultgate: {error}",saved:"Paired. The key was saved to {file}"},key:{invalidName:"invalid tool name {name}",noSaved:'no key for {name}: run "node src/main.js login --name {name}" first',invalidSaved:"the key file for {name} is not a Vaultgate tool key",unreadable:'the key for {name} cannot be opened here (other user or PC): run "node src/main.js login --name {name}" again',exchangeFailed:"Vaultgate refused the key exchange: {rule}"},portal:{opened:"Portal opened in an isolated {browser} window (own profile, without extensions).",extensions:"Note: {count} extension(s) in the portal profile (policy-managed?)."}},errors:{VAULT_LOCKED:"The vault is locked.",DEVICE_CODE_INVALID:"The pairing code is not right. Check the code in your terminal and type it again.",WRONG_CREDENTIALS:"That did not open the vault.",TOO_MANY_ATTEMPTS:"Too many attempts. Wait a moment and try again.",UNAUTHENTICATED:"Sign in first.",VAULT_EXISTS:"There is already a vault here.",PRF_REQUIRED:"This key cannot open the vault (it has no PRF). Use a security key, your phone or Windows Hello.",DUPLICATE_NAME:"That name is already taken.",INVALID_NAME:"Use letters, digits, _ . - (up to 64).",WEBAUTHN_FAILED:"The passkey could not be verified. Try again.",PASSKEY_CREATE_FAILED:"Creating the passkey did not finish (stopped after {seconds} s). On a phone: scan the QR code, then save the passkey in the app the phone offers. Try again, or choose another key.",PASSKEY_PRF_FAILED:"The passkey was created, but reading its vault key did not finish (stopped after {seconds} s). Your phone or app may not support the PRF extension that Vaultgate needs to open the vault. Try a security key or this PC.",VAULT_ROLLED_BACK:"This is an older copy of the vault. Confirm in the warning below if you restored it on purpose.",CODE_CHANGED:"Vaultgate's own files changed. Confirm in the warning below if you updated or changed it yourself.",STEP_UP_REQUIRED:"Touch your passkey to confirm this change. Nothing was changed.",STEP_UP_CANCELLED:"Confirming with a touch did not finish. Nothing was changed.",STEP_UP_UNAVAILABLE:"No passkey can confirm this change (blocked, or not allowed by the touch setting). Nothing was changed.",LAST_PASSKEY:"Keep at least one passkey that is not blocked.",INVALID_QUIET_HOURS:"Use windows like 23:00-07:00 (24 h), one per line."}};var ot={portal:{windowWarning:"Je opent het portaal in een gewone browsertab: extensies en het gedeelde profiel kunnen meelezen wat je intikt. Open het via de tray (Portaal openen) of met",common:{all:"alle",host:"Host",name:"Naam",onUse:"Bij gebruik",passphrase:"Passphrase",secret:"Secret",tool:"Tool",unlock:"Ontgrendelen",virtualKey:"Virtuele key",waitingForKey:"Wachten op je sleutel…"},duration:{always:"Altijd","30m":"30 min","1h":"1 uur","4h":"4 uur"},mode:{silent:"stil",notify:"met melding",confirm:"elke keer vragen",silentLong:"Stil doorlaten",notifyLong:"Doorlaten met een melding",confirmLong:"Elke call opnieuw vragen"},header:{noVault:"nog geen kluis",locked:"kluis dicht",open:"kluis open",openFor:"Vergrendelt over {minutes} min",lock:"Vergrendelen",logout:"Afmelden",timerTip:"Het portaal vergrendelt na de tijd uit Instellingen zonder gebruik; tools met een toekenning werken door. Afmelden sluit de kluis. Ontgrendelen is één aanraking.",lockTip:"Sluit het portaal.",logoutTip:"Meld je af in het portaal.",session:"Sessie"},tabs:{activity:"Activiteit",keys:"Virtuele keys",secrets:"Secrets",grants:"Toekenningen",certificates:"Certificaten",passkeys:"Authenticatie",settings:"Instellingen"},welcome:{promise1:"Je agents gebruiken je secrets.",promise2:"Ze krijgen ze nooit.",pitch:"Vaultgate staat tussen je AI-tools en het internet. Het vult je sleutels pas in op het moment dat een request vertrekt, en alleen waar jij het toestaat.",tagline:"Draait op je pc. Open source. Geen abonnement.",stepWelcome:"Welkom",stepPasskeys:"Ontgrendelen",stepKey:"Virtuele key",stepDone:"Klaar",how1:"Je passkey is de sleutel van de kluis",how1Text:"Geen wachtwoord om te onthouden en geen herstelcode om te bewaren. Een security key, je telefoon of deze pc.",how2:"Elke tool krijgt een virtuele key",how2Text:"Die werkt alleen op deze pc en via Vaultgate. Lekt hij, dan trek je hem in één klik in.",how3:"Wat niet mag, gaat niet",how3Text:"Elke beslissing heeft een naam en staat in je logboek. Ook wat tegengehouden werd.",start:"Beginnen",keysTitle:"Hoe wil je je kluis openen?",keysIntro:"Eén aanraking opent ze. Geen wachtwoord om te onthouden.",keyTitle:"Koppel je eerste tool",skip:"Later",next:"Verder",doneTitle:"Klaar om te beginnen!",finish:"Open het portaal",duration:"Duurt ongeveer twee minuten.",back:"Terug",keyIntro:"De tool krijgt een eigen virtuele key. Je echte secrets blijven in de kluis.",wayBest:"best",paired:"{name} is gekoppeld en heeft een eigen virtuele key.",manualHelp:"Voor tools waar je alleen een proxyadres en een API-key kunt invullen. Je ziet de key één keer; daarna staat hij in de instellingen van de tool, werkt hij alleen via Vaultgate en kun je hem altijd intrekken.",donePasskeys:"{count} passkeys openen de kluis",doneTools:"Gekoppeld met een eigen virtuele key: {names}",doneNoTools:"Nog geen tool gekoppeld. Dat kan later bij Virtuele keys.",doneEncrypted:"Alles staat versleuteld op deze pc, ook namen en het logboek",doneNext:"Daarna, wanneer je wilt",nextSecret:"Voeg je eerste secret toe",nextSecretText:"een API-key, één keer getoond en daarna nooit meer",nextGrant:"Ken het toe aan een tool",nextGrantText:"of keur het goed in de tray bij het eerste gebruik",donePasskeysOne:"1 passkey opent de kluis",twoKeysTitle:"Voeg er minstens twee toe.",twoKeysText:"Dan is één verloren sleutel geen verloren kluis.",vaultCreated:"Kluis gemaakt met je eerste sleutel.",pathTitle:"Het pad van elke request",pathTool:"je tool",pathDomain:"domein"},login:{title:"Inloggen",passkeyText:"Raak je passkey aan. Die opent ook de kluis.",go:"Inloggen met passkey",bootstrapText:"Er is nog geen passkey geregistreerd. Ontgrendel met je passphrase om er een te registreren.",lost:"Passkeys en passphrase kwijt?",recoveryCode:"Herstelcode",newPassphrase:"Nieuwe passphrase",recover:"Herstellen",startOver:"Al je sleutels kwijt? Dan begin je opnieuw met een nieuwe kluis; je secrets staan nog bij hun bron."},unlock:{title:"De kluis is dicht",passkeyText:"Ze sluit zichzelf na een tijd zonder gebruik. Raak je passkey aan om ze weer te openen.",passkeyGo:"Ontgrendelen met passkey",passphraseText:"Of ontgrendel met je passphrase (bijvoorbeeld als je passkey geen PRF heeft).",phoneGo:"Liever mijn telefoon (QR scannen)"},recovery:{title:"Je herstelcode",text:"Bewaar deze code op papier of in een andere kluis. Je ziet hem nu één keer. Ben je je passkeys en je passphrase kwijt, dan opent alleen deze code de kluis nog.",confirm:"Tik ter controle de laatste 4 tekens over",done:"Ik heb hem bewaard"},main:{noPasskey:"Nog geen passkey geregistreerd. Voeg er een toe onder Passkeys: zonder passkey kun je straks niet inloggen.",onePasskey:"Je hebt één passkey. Voeg er een tweede toe, zodat een verloren sleutel geen verloren toegang is."},wizard:{title:"Aan de slag",passkey:"Passkey",key:"Virtuele key",secret:"Secret",firstCall:"Eerste call",next:{passkey:"Voeg je passkey toe: zonder passkey kun je straks niet inloggen.",key:"Maak een virtuele key voor je tool (of koppel ze met de device flow).",secret:"Voeg je eerste secret toe, met het domein waar het naartoe mag.",grant:"Laat de tool een eerste call doen (goedkeuren in de tray), of voeg een toekenning toe."},go:{passkey:"Naar Passkeys",key:"Naar Virtuele keys",secret:"Naar Secrets",grant:"Naar Toekenningen"},checkIntro:"Controleer zonder echte call welke regel een call van deze key met dit secret zou krijgen:",check:"Controleer",result:{granted:"werkt: een call gaat meteen door","needs-approval":"de eerste call vraagt goedkeuring in de tray (of voeg een toekenning toe)","tool-key-revoked":"deze virtuele key is ingetrokken","unknown-secret":"dit secret bestaat niet","target-host-not-allowed":"het domein staat niet in de allowlist van het secret"}},audit:{title:"Activiteit",all:"alle beslissingen",allowed:"doorgelaten",stopped:"tegengehouden",decision:"Beslissing",filter:"Filteren",empty:"Nog niets.",statAllowed:"doorgelaten",statStopped:"tegengehouden",statScrubbed:"onderschept in antwoorden",latest:"Laatste beslissingen",introNone:"Niets wacht op jou. Elke beslissing draagt de naam van de regel die haar nam.",introOne:"1 ding wacht op jou. Elke beslissing draagt de naam van de regel die haar nam.",intro:"{count} dingen wachten op jou. Elke beslissing draagt de naam van de regel die haar nam.",repeat:"Dezelfde beslissing {count} keer sinds {since}.",renew:"Toekenning vernieuwen",createSecret:"Secret aanmaken",allowHost:"Toestaan als nieuwe toekenning",allowPlace:"Deze plek toestaan",allowPlaceConfirm:"{secret} ook invullen in {place}? Doe dit alleen als de dienst het daar verwacht.",admin:"beheer",via:{portal:"in het portaal",tray:"in de tray",device:"door een koppeling",proxy:"door de eerste toegestane call"},noTool:"onbekende client",pick:"Kies links een beslissing om te zien waarom ze genomen werd.",fact:{when:"Wanneer",repeat:"Herhaald",request:"Request",from:"Vanaf",change:"Wijziging",connection:"Verbinding"}},keys:{newTitle:"Nieuwe virtuele key",kindWeb:"Webrequests",kindMcp:"MCP-server",otherMachines:"Gebruikt vanaf een andere machine?",clients:"Clients buiten deze pc (IP of subnet)",create:"Key maken",keyTitle:"Je virtuele key:",keyOnce:"je ziet hem alleen nu.",configTitle:"Zet dit in de tool",configAnthropic:"Claude Code en andere Anthropic-clients",configForward:"Elke andere API: een plaatshouder in een header, de virtuele key apart",kind:"Soort",domains:"Heeft toegang tot",noDomains:"nog niets",thisPcOnly:"alleen deze pc",active:"actief",revoked:"ingetrokken",rotate:"Roteren",reactivate:"Heractiveren",reactivateConfirm:"{name} heractiveren? Haar key en toekenningen werken dan weer.",revoke:"Intrekken",revokeConfirm:"{name} intrekken? De tool kan niets meer tot je ze heractiveert.",dialogTitleWeb:"Virtuele key voor webrequests",dialogTitleMcp:"Virtuele key voor een MCP-server",copy:"Kopiëren",copied:"Gekopieerd",copiedNote:"Gekopieerd. Na 60 seconden wist Vaultgate het klembord als de key er nog op staat. Edge kan één keer vragen of het klembord gelezen mag worden. De klembordgeschiedenis van Windows (Win+V) bewaart een eigen kopie.",gotIt:"Begrepen",close:"Sluiten",intro:"Elke tool krijgt een eigen virtuele key. Lekt een key, dan trek je hem in; je echte secrets blijven dezelfde.",empty:"Nog geen virtuele keys. Maak er een, of koppel een tool.",waiting:"Een tool wil koppelen",waitingHelp:"Typ de code uit je terminal in het koppelverzoek voordat je het toestaat.",edit:"Bewerken",editTitle:"{name} bewerken",editName:"Naam van de tool",editOther:"Ook vanaf andere adressen",editSave:"Opslaan",thisPcAnd:"deze pc + {list}",rotateConfirm:"De key van {name} roteren?",rotateWarning:"De oude key werkt meteen niet meer.",rotating:"Roteert automatisch",manual:"Handmatig — roteert niet",rotatingHelp:"Telkens als deze tool haar key vraagt, geeft Vaultgate een token dat 10 minuten werkt en vervangt het de bewaarde key door een nieuwe. Wordt een oude kopie gebruikt, dan trekt Vaultgate de tool in en meldt het dat. Een programma dat als jou draait en zelf een token vraagt, houdt het niet tegen.",manualHelp:'Deze key blijft dezelfde tot je ze roteert: Vaultgate verandert ze niet waar jij ze zette (een omgevingsvariabele of een configbestand). Koppel de tool met "login --name", dan roteert haar key vanzelf.',reask:"Opnieuw om mijn passkey vragen",reaskOff:"nooit",reaskHours:"elke {hours} u",reaskHelp:"Haalt de tool na deze tijd een nieuw token, dan vraagt Vaultgate je passkey aan te raken.",tools:"Tools",count:"{count} in totaal",pick:"Kies links een key.",grants:"Toekenningen",created:"gezet op {date}; één keer getoond, nooit meer",fact:{from:"Calls vanaf",key:"Key"}},secrets:{addTitle:"Een secret toevoegen",value:"Waarde",sensitive:"Gevoelig",sensitiveHelp:"Elke goedkeuring, ook eenmalig, vraagt dan een aanraking van je passkey.",add:"Opslaan in de kluis",saved:"Secret opgeslagen. De waarde wordt niet meer getoond.",sensitiveBadge:"gevoelig",legacyInject:"elke header (oud: stel in)",rotate:"Roteren",rotatePrompt:"Nieuwe waarde voor {name}. Maak ze eerst bij de provider en plak ze dan hier.",revoke:"Verwijderen",revokeConfirm:"{name} verwijderen? Dit kan niet ongedaan gemaakt worden.",intro:"Je echte keys en logins. Vaultgate vult ze in een request in terwijl die vertrekt, alleen voor de domeinen die je toelaat.",footer:"Een waarde verlaat de kluis nooit, behalve in de request waarvoor ze bedoeld is. Niet meer zeker? Roteer ze met een nieuwe waarde van de provider.",addIntro:"Vaultgate versleutelt het meteen. Na opslaan kan niemand het teruglezen, ook jij niet.",kindKey:"API-key of token",kindKeyHelp:"één waarde, zoals sk-…",kindLogin:"Login",kindLoginHelp:"gebruikersnaam en wachtwoord, optioneel 2FA",kindService:"Gekoppelde dienst",later:"komt later",username:"Gebruikersnaam",password:"Wachtwoord",kindLoginNote:"Login. Vaultgate vult zelf de gebruikersnaam en het wachtwoord in.",domain:"Domein",domainHelp:"Alleen dit domein krijgt het secret. Al de rest wordt tegengehouden.",never:"Nooit meer getoond. Later wijzigen doe je met Roteren.",clipboardNote:"Wis na het plakken je klembordgeschiedenis (Win+V). Vaultgate toont of retourneert de waarde nooit meer.",rotateWarning:"Wis na het plakken je klembordgeschiedenis (Win+V). De oude waarde stopt meteen met werken.",on:"Aan",recommended:"aangeraden",editTitle:"{name} bewerken",editIntro:"Alles behalve de waarde. Voor een nieuwe waarde: Roteren.",domains:"Domein en zijn subdomeinen",addDomain:"een subdomein toevoegen…",removeDomain:"Verwijderen",grantsNone:"nog geen toekenningen",grantsOne:"1 toekenning",grants:"{count} toekenningen",empty:"Nog geen secrets. Voeg je eerste toe.",revokeGrants:"Zijn toekenningen gaan mee: {list}. De key zelf werkt nog bij de provider: trek ze daar ook in.",renameWarning:"Tools die {{secret:{old}}} vragen, moeten de nieuwe naam gebruiken. Toekenningen en routes gaan mee.",places:"Ingevuld in",learning:"nog niet gekend: de eerste toegestane call legt het vast",placesHelp:"Waar het secret in een request komt. Een andere plek wordt tegengehouden; die kan je toestaan vanuit Activiteit (hooguit 3).",vault:"In de kluis",figVault:"in de kluis",pick:"Kies links een secret.",kindKeyNote:"API-key of token. Ingevuld in requests naar zijn domeinen, nergens anders.",touchGrant:"alleen voor een toekenning, niet bij elke request",touchSensitive:"bij elke goedkeuring, ook een eenmalige",valueSet:"gezet op {date}; nooit meer getoond",fact:{domain:"Domein",subdomains:"Andere domeinen",touch:"Aanraken"}},grants:{addTitle:"Toekenning toevoegen",add:"Toekennen",filterTool:"Filter op virtuele key",filterSecret:"Filter op secret",fromTray:"goedgekeurd in de tray",fromPortal:"toegevoegd in het portaal",expired:"verlopen",revoke:"Verwijderen",intro:"Een toekenning laat één tool één secret gebruiken op één domein. Jij kiest wat er bij gebruik gebeurt, en hoe lang.",footer:"Zonder toekenning vraagt een call het je in de tray; geen antwoord betekent tegengehouden (approval-timeout). Andere tegengehouden calls staan in Activiteit, elk met hun regel.",addIntro:"Eén tool, één secret, één domein. Of sla dit over: de eerste call vraagt het in de tray.",chooseTool:"Kies een tool…",chooseSecret:"Kies een secret…",chooseDomain:"Kies een domein…",validFor:"Geldig voor",validHelp:"Daarna rust ze; de volgende call vraagt het je opnieuw.",editTitle:"Toekenning bewerken",extendBy:"Verlengen met",keep:"De resterende tijd houden",plus30m:"+ 30 min",plus1h:"+ 1 uur",plus4h:"+ 4 uur",leftMin:"nog {n} min",leftHours:"nog {n} u",renew:"Vernieuwen",revokeConfirm:"Deze toekenning verwijderen? {chain}. De volgende call van deze combinatie vraagt het je opnieuw in de tray.",empty:"Nog geen toekenningen. De eerste call van een tool vraagt het je in de tray.",allTools:"alle virtuele keys",allSecrets:"alle secrets",temporary:"voorlopig: {mode}; daarna geldt de regel hierboven weer",endTemporary:"Nu beëindigen",newDomain:"{host} (nieuw domein voor dit secret)",allDomains:"Alle domeinen van dit secret",uses:"gebruikt",pick:"Kies links een toekenning.",noteRunning:"Calls gaan door tot {time}. Daarna vraagt de volgende call het je opnieuw.",noteAlways:"Zonder einde. Verwijder ze hier als de tool ze niet meer nodig heeft.",noteExpired:"Verlopen: de volgende call vraagt het je in de tray. Vernieuw ze om calls weer door te laten.",fact:{origin:"Goedgekeurd"}},device:{enterCode:"Typ de code uit de terminal van {name} om deze koppeling te bevestigen.",checkCode:"Code controleren",client:"Vanaf",since:"Sinds",exists:"bestaat al: wordt geweigerd",rotated:"geroteerd: typ de code om opnieuw te koppelen",approve:"Toestaan",deny:"Weigeren",empty:"Geen wachtende koppelingen.",noTouch:"Niet gekoppeld: geen aanraking van je passkey.",paired:"Gekoppeld: {name} heeft zijn key.",pairedEmpty:"Nog geen tools gekoppeld."},passkeys:{intro:"De sleutels die je kluis openen. Hou er minstens twee, zodat één verloren sleutel geen verloren kluis is.",add:"Sleutel toevoegen",securityKey:"Security key",securityKeyHelp:"het sterkst: de sleutel zit niet in je pc",phone:"Telefoon",phoneHelp:"QR-code scannen, bevestigen met je vingerafdruk",thisPc:"Deze pc (Windows Hello)",thisPcHelp:"snel, maar op dezelfde machine als je agents",another:"Nog een sleutel",recommended:"aangeraden",anotherHelp:"je telefoon of een tweede security key",nothingToKeep:"Geen wachtwoord, geen herstelcode op papier: niets dat iemand kan stelen. Ben je al je sleutels kwijt, dan begin je opnieuw; je secrets staan nog bij hun bron.",unlocks:"opent de kluis",noPrf:"logt in, maar opent de kluis niet",remove:"Verwijderen",removeConfirm:'De passkey "{name}" verwijderen?',registered:"Passkey toegevoegd. Ze opent de kluis.",registeredNoPrf:"Passkey toegevoegd, maar zonder PRF: ze logt je in, de kluis opent met je andere sleutel.",kind:{securityKey:"Security key",phone:"Telefoon",thisPc:"Deze pc",unknown:"Passkey"},addTitle:"Een passkey toevoegen",opens:"{count} sleutels openen de kluis.",opensOne:"1 sleutel opent de kluis.",signInOnly:"{count} zonder PRF melden je alleen aan om de activiteit te bekijken: ze openen de kluis niet.",rename:"Hernoemen",renamePrompt:'Een naam voor deze passkey, zodat je weet welke sleutel welke is (bijvoorbeeld "YubiKey sleutelbos"). Leeg: de soort.',lastUsed:"laatst gebruikt {date}",yours:"Je passkeys",figOpens:"openen de kluis",figSigns:"melden alleen aan",vault:"Kluis",added:"Toegevoegd",used:"Laatst gebruikt",prfNote:"Opent de kluis: haar PRF-uitvoer pakt de kluissleutel uit. Zonder deze sleutel of een andere zoals zij blijft de kluis dicht.",noPrfNote:"Meldt je aan om activiteit te bekijken, maar heeft geen PRF: ze kan de kluis niet openen en geen secret ontsleutelen."},settings:{title:"Instellingen",language:"Taal",languageSystem:"Zoals het systeem",touch:"Aanraken met",touchAny:"elke passkey",touchExternal:"alleen een externe sleutel",timeout:"Tijd om de tray te beantwoorden",autolock:"Automatisch vergrendelen",listeners:"Andere machines",routes:"Extra routes",saved:"Instellingen opgeslagen.",intro:"Hoe Vaultgate het je vraagt, zichzelf vergrendelt en luistert. Wijzigingen gelden vanaf de volgende request.",auto:"Automatisch bewaard",groupVault:"Kluis en goedkeuringen",groupLook:"Weergave",groupNetwork:"Netwerk",autolockHelp:"na zo lang zonder gebruik",timeoutHelp:"daarna wordt de request geweigerd",touchHelp:'voor "altijd", gevoelige secrets en koppelen',languageHelp:"in deze browser",listenersNone:"extra luisteradressen: geen",listenersIntro:"Standaard luistert Vaultgate alleen op deze pc. Voeg een adres toe om tools op andere machines binnen te laten, bijvoorbeeld een VM.",listenersWarning:"Virtuele keys en secrets gaan onversleuteld over het lokale netwerk, zonder TLS. Luister alleen op private, host-only of vertrouwde netwerkadapters.",listenersLabel:"Luisteradressen (ip:poort), één per regel",listenersHelp:"Een virtuele key moet de client ook toelaten: Virtuele keys, Bewerken.",routesNone:"geen",routesIntro:"Een pad op Vaultgate dat doorstuurt naar een host, voor tools die alleen een basis-URL aannemen. Het secret gaat in de header die je kiest.",routeAdd:"Een route toevoegen",routeName:"Padnaam",routeBase:"Stuurt door naar",routeHeader:"Header",groupQuiet:"Rustige uren en meldingen",quietHours:"Rustige uren",quietHoursHelp:"elke call wordt tegengehouden, zonder je iets te vragen",quietNone:"geen",quietIntro:"Tijdens deze uren houdt Vaultgate elke call tegen (regel quiet-hours) en vraagt niets in de tray. Lokale tijd; een venster mag over middernacht gaan.",quietLabel:"Vensters (UU:MM-UU:MM), één per regel",quietHelp:"Een venster weghalen of wijzigen vraagt een aanraking van je passkey.",notifications:"Meldingen",notificationsHelp:"voor toekenningen met een melding; goedkeuringen in de tray vragen nog altijd",theme:"Thema",themeHelp:"donker of licht, voor deze browser",themeSystem:"Zoals Windows",themeDark:"Donker (Dracula)",themeLight:"Licht (Console)",groupDanger:"Gevarenzone",deleteVault:"Kluis verwijderen",deleteVaultHelp:"Verwijdert alle secrets, tools en passkeys definitief. Dit kan niet ongedaan worden gemaakt.",deleteVaultConfirm:"Weet je zeker dat je deze kluis wilt verwijderen?",deleteVaultWarning:"Alle secrets en virtuele keys worden definitief verwijderd. Je begint opnieuw met een nieuwe kluis.",vaultDeleted:"Kluis verwijderd. Je kunt opnieuw beginnen."},tls:{title:"Certificaten",subtitle:"Roots die Node en Mozilla vertrouwen, en een vernieuwd certificaat onder een bekende root, vragen niets van jou. Een nieuwe root die je niet vertrouwt, stopt elke request tot je hier beslist.",guideBtn:"Beveiligingsgids & waarschuwing",reviewBtn:"Roots op deze pc bekijken",keepBlocking:"Blijf blokkeren",reviewTrust:"Bekijken & vertrouwen…",emptyTrusted:"De roots die Node en Mozilla vertrouwen hebben niets van jou nodig; ze staan hier niet tussen.",scopeGlobal:"alle domeinen (geïnspecteerd in Activity)",chainIntact:"keten intact",details:"Details",revoke:"Vertrouwen intrekken",introTitle:"Voordat je een certificaat vertrouwt",introDesc:"Vaultgate garandeert dat secrets alleen over gecontroleerde verbindingen reizen. Als een certificaat niet vertrouwd of gewijzigd is, stoppen verzoeken onmiddellijk.",step1Title:"Controleer de naam van het certificaat",step1Desc:"Identificeer wie het certificaat heeft uitgegeven. Zoek de naam online op of verifieer deze bij IT-support als je hem niet herkent.",step2Title:"Vertrouw alleen bekende, geautoriseerde software",step2Desc:"Vertrouw het alleen als het hoort bij de inspectieproxy van je organisatie (bv. Zscaler, Fortinet) of je eigen ontwikkelaarstools (bv. mkcert, Fiddler). Is de bron onbekend: vertrouw het nooit.",inspectionWarnTitle:"Inspectiewaarschuwing:",inspectionWarn:"Wanneer je een certificaat-root vertrouwt, kan de software of entiteit achter dat certificaat al je ontsleutelde netwerkverkeer meelezen en inspecteren, inclusief API-aanroepen en responses.",understand:"Ik begrijp het",trustTitle:"Vertrouw je {root}?",trustWarn:"Het vertrouwen van deze root geeft {root} de mogelijkheid om al het netwerkverkeer en de secrets die erdoorheen gaan te ontsleutelen en mee te lezen.",trustInstruction:"Vertrouw deze root alleen als je hem herkent als de beveiligingsproxy van je bedrijf of je eigen ontwikkeltool. Vergelijk de vingerafdruk met IT of zoek de uitgever op.",trustScope:"Kies reikwijdte:",scopeHostTitle:"Alleen voor {origin}",scopeHostDesc:"Minste privileges. Andere domeinen vragen nog steeds als ze deze root gebruiken.",scopeGlobalTitle:"Voor alle domeinen (bedrijfsproxy)",scopeGlobalDesc:"Aanbevolen voor Zscaler/Fortinet. Requests tonen een oranje inspected-badge in Activity.",trustTouch:"Vertrouw met een aanraking",untrustTitle:"Vertrouwen in {root} intrekken?",untrustDesc:"Verzoeken via {root} worden weer tegengehouden met tls-untrusted.",untrustImmediate:"Het beperken van vertrouwen treedt direct in werking en vereist geen aanraking.",untrustConfirm:"Vertrouwen intrekken",detailsIssuer:"Uitgever",detailsFingerprint:"Vingerafdruk",detailsValid:"Geldigheid",detailsScope:"Reikwijdte",reviewRootsTitle:"Roots op deze pc",reviewRootsDesc:"Roots in de Windows-store die Node en Mozilla niet vertrouwen. Vaultgate vertrouwt er geen tenzij jij dat zegt.",noExtraRoots:"Geen extra roots gevonden.",titleChanged:"Certificaat gewijzigd voor {origin}",titleUntrusted:"Certificaat nog niet vertrouwd voor {origin}",text:"Eerder: {before} · nu: {now}. Er gaat geen secret naartoe tot je de nieuwe keten vertrouwt. Was dit niet verwacht (bijvoorbeeld op een ander netwerk), vertrouw ze dan niet.",textUntrusted:"Uitgever nu: {now} · root: {root} · geldig tot: {validTo}. Deze root is nog niet vertrouwd; er gaat niets heen tot je ze vertrouwt.",trust:"Nieuwe keten vertrouwen",doNotTrust:"Niet vertrouwen (aanbevolen)",colBefore:"Eerder",colNow:"Nu",issuer:"Uitgever",root:"Root",validTo:"Geldig tot",fingerprint:"Vingerafdruk",noEarlier:"geen",roots:"Roots",waits:"{count} wacht op jou",trusted:"vertrouwd",inspected:"geïnspecteerd",allDomains:"alle domeinen",trustedAll:"vertrouwd, alle domeinen",trustedOne:"vertrouwd, één domein",globalNote:'Ze kan lezen wat erdoor gaat. Elke request die ze behandelt, staat als "geïnspecteerd" in Activiteit.',hostNote:"Alleen voor {origin}. Elk ander domein dat bij deze root eindigt, wordt tegengehouden.",changedNote:"De keten van {host} eindigt nu bij {root}, een root die je niet vertrouwt. Een man-in-the-middle ziet er precies zo uit. Er vertrok niets: secrets bleven in de kluis.",untrustedNote:"{host} eindigt bij {root}, een root die je niet vertrouwt. Er vertrok niets: secrets bleven in de kluis.",notYours:"Niet de proxy van je bedrijf? Blijf blokkeren: doe niets.",requests:"Requests",stopped:"tegengehouden tot je beslist",trustedAt:"Vertrouwd",chain:"Keten"},ask:{ok:"OK",cancel:"Annuleren",show:"Tonen"},menu:{label:"Hoofdmenu",waits:"wacht op jou"},keyCreate:{nameTitle:"Geef de tool een naam",nameHelp:"Zo staat ze in je log en in elke goedkeuring.",kindTitle:"Hoe roept ze naar buiten?",webHelp:"een agent of script dat een API aanroept",mcpHelp:"Claude Code, Claude Desktop, VS Code",giveTitle:"Geef haar een key",wayAuto:"Automatisch koppelen",wayAutoHelp:"je ziet de key nooit",wayManual:"Zelf de key kopiëren",wayManualHelp:"voor tools met alleen een veld voor proxy en API-key",pairRun:"a. Voer dit uit waar de tool draait:",pairCheck:"b. Je terminal toont een code. Kijk of ze hier dezelfde is, en sta ze dan toe.",mcpCreateHelp:"Maak de key en zet de configuratie in je MCP-client. Je ziet de key één keer."},waiting:{title:"Wacht op jou",none:"Niets wacht op jou.",pair:"{name} wil koppelen",tls:"Het certificaat van {host} veranderde",approval:"{tool} vraagt {secret} voor {host}: antwoord in de tray",review:"Bekijken",decide:"Beslissen",check:"Nakijken"},rollback:{title:"Dit is een oudere kopie van de kluis",text:"De kluis in deze map is ouder dan de laatste die op deze pc openging. Dat gebeurt bij het terugzetten van een back-up, maar ook als iemand een oude kopie terugzet om een ingetrokken tool of een verwijderde toekenning terug te halen. De kluis blijft dicht tot je het bevestigt.",accept:"Ik heb deze back-up bewust teruggezet: toch openen"},integrity:{title:"Bestanden van Vaultgate zelf zijn veranderd",text:'Deze bestanden van Vaultgate zijn niet meer dezelfde als toen de kluis hier het laatst openging. Dat gebeurt na een update, maar ook als een programma Vaultgate aanpast, bijvoorbeeld zodat de tray altijd "toestaan" antwoordt. De kluis blijft dicht tot je het bevestigt.',accept:"Ik heb Vaultgate zelf bijgewerkt of aangepast: de kluis toch openen"},pause:{block:"Blokkeren",silence:"Stil","15m":"15 minuten","1h":"1 uur",tomorrow:"tot morgen",forever:"tot ik het ophef",blockedUntil:"geblokkeerd tot {time}",blockedForever:"geblokkeerd tot je het ophef",unblock:"Vrijgeven",silencedUntil:"stil tot {time}",unsilence:"Meldingen aan"},specs:{title:"Beveiliging",help:"De sleutelhiërarchie, de versleuteling en haar parameters, uitgelegd op de website.",link:"Bekijk de technische beveiligingsspecificatie"},mcpInstall:{help:"Zet Vaultgate met één klik in je agents op deze pc. De agent krijgt de naam van de tool, nooit de key; herstart de agent daarna.",none:"Geen agents gevonden op deze pc.",otherAgent:"Een andere agent of een andere plek?",copyJson:"JSON kopiëren",copyJsonVscode:"JSON kopiëren (VS Code)",statusPage:"MCP-statuspagina en tools",install:"Installeren",uninstall:"Verwijderen",scopeUser:"Alle mappen (gebruiker)",scopeProject:"Specifieke map (project)",folderPlaceholder:"Pad naar projectmap (bijv. C:\\git\\mijn-project)",missing:"niet meer gevonden",skillTitle:"Agent-skill en policy",skillHelp:"Kopieert SKILL.md en stelt de kernregel in voor Claude, Copilot en andere agents.",installSkill:"Skill installeren",uninstallSkill:"Skill verwijderen",status:{installed:"Geïnstalleerd",updated:"Bijgewerkt",unchanged:"Al geïnstalleerd",removed:"Verwijderd",absent:"Niet aanwezig",error:"Mislukt"},whereTitle:"Waar",agentsTitle:"Agents op deze pc",refresh:"Bijwerken",refreshNothing:"Alles is actueel; er is geen bestand veranderd.",changedTitle:"Vaultgate paste deze bestanden aan",backupNote:"De oude versie staat in {path}"}},touch:{title:"Raak je passkey aan",why:"Een programma kan op knoppen klikken. Het kan je passkey niet aanraken.",deny:"Annuleren en weigeren",confirm:"Aanraken om te bevestigen",gone:"Deze vraag bestaat niet meer (verlopen of al beantwoord).",question:{always:"{tool} wil {secret} voortaan gebruiken op {host}.",sensitive:"{tool} wil het gevoelige secret {secret} gebruiken op {host}.",device:"{tool} wil gekoppeld worden en een eigen key krijgen.",reask:"{tool} wil een nieuw token. Je vroeg Vaultgate om dat om de paar uur met jou na te gaan."},code:"Code",request:"Request",denied:"Geweigerd. Je kunt dit venster sluiten.",confirmed:"Bevestigd. Je kunt dit venster sluiten.",failed:"Niet bevestigd: geen geldige aanraking. De vraag is geweigerd.",codeHint:"Code {code} komt overeen met je terminal. Raak je passkey aan om te bevestigen.",close:"Venster sluiten",pairTitle:"{tool} koppelen?",confirmedTitle:"Bevestigd",deniedTitle:"Geweigerd",goneTitle:"Niets te bevestigen",closeHint:"Venster nog open? Sluit het met Alt+F4."},rules:{fallback:{allow:"{tool} gebruikte {secret} op {host}.",deny:"{tool} werd tegengehouden; er is niets ontsleuteld.",admin:"Er werd een instelling gewijzigd."},granted:"{tool} gebruikte {secret} op {host}.","approved-once":"{tool} gebruikte {secret} op {host}, eenmalig goedgekeurd.","approved-always":"{tool} gebruikte {secret} op {host}; je stond het voortaan toe.","approved-30m":"{tool} gebruikte {secret} op {host}; toegestaan voor 30 minuten.","approved-1h":"{tool} gebruikte {secret} op {host}; toegestaan voor 1 uur.","approved-4h":"{tool} gebruikte {secret} op {host}; toegestaan voor 4 uur.","target-host-not-allowed":"{tool} wou {secret} naar {host} sturen. Tegengehouden; er is niets ontsleuteld.","no-tool-key":"Een call zonder geldige virtuele key. Tegengehouden.","tool-key-revoked":"{tool} gebruikte een ingetrokken key. Tegengehouden.","client-not-allowed":"{tool} belde vanaf een machine die niet mag. Tegengehouden.","no-placeholder":"{tool} deed een call zonder plaatshouder voor een secret. Tegengehouden.","unknown-secret":"{tool} vroeg {secret}, dat niet bestaat. Tegengehouden.","placeholder-location-not-allowed":"{tool} zette {secret} op een plek waar het niet mag. Tegengehouden.","bad-target":"{tool} vroeg {secret} voor {host} met een gecodeerd teken in het pad (zoals %2f), waarmee het toegestane pad omzeild kon worden. Tegengehouden; er is niets ontsleuteld.","grant-expired":"De toekenning van {tool} voor {secret} is verlopen; opnieuw gevraagd.","approval-denied":"Je weigerde {tool} om {secret} op {host} te gebruiken.","approval-timeout":"Niemand antwoordde op tijd voor {tool} → {secret} → {host}. Geweigerd.","approval-unavailable":"{tool} had een goedkeuring nodig, maar de tray draaide niet. Geweigerd.","touch-denied":"Je passkey werd niet aangeraakt voor {tool} → {secret}. Geweigerd.","touch-timeout":"Geen aanraking van je passkey op tijd voor {tool} → {secret}. Geweigerd.","vault-locked":"De kluis was dicht; er is niets ontsleuteld.",throttled:"Te veel foute pogingen; deze beller wacht voor hij een antwoord krijgt.","tls-chain-changed":"Een andere certificaatketen voor {host}. Er gaat niets heen tot jij beslist.","tls-chain-accepted":"Je vertrouwde de nieuwe certificaatketen voor {host}.","audit-unavailable":"Het logboek kon niet geschreven worden, dus er is niets verzonden.","device-requested":"{tool} vroeg om gekoppeld te worden.","device-approved":"Je koppelde {tool}.","device-delivered":"{tool} kreeg zijn key.","device-expired":"De koppelvraag van {tool} is verlopen.","device-name-taken":"{tool} vroeg een naam die al bestaat. Geweigerd.","tunnel-not-supported":"Een tunnel naar {host} werd geweigerd: Vaultgate kan daarin niets invullen of controleren.","response-scrubbed":"{host} stuurde {secret} terug in zijn antwoord; Vaultgate haalde het weg voor {tool} het zag.","subdomain-denied":"{tool} vroeg {secret} voor {host}, een nieuw subdomein; het werd niet toegevoegd. Tegengehouden; er werd niets ontsleuteld.","secret-added":"Secret {secret} werd toegevoegd.","secret-rotated":"De waarde van {secret} werd vervangen.","secret-hosts-changed":"De domeinen van {secret} werden gewijzigd.","secret-places-changed":"Waar {secret} ingevuld mag worden, werd gewijzigd.","secret-sensitive-changed":"Gevoelig werd gewijzigd voor {secret}.","secret-renamed":"Een secret heet nu {secret}.","secret-removed":"Secret {secret} werd verwijderd, met zijn toekenningen.","tool-added":"Virtuele key {tool} werd aangemaakt.","tool-renamed":"Een virtuele key heet nu {tool}.","tool-clients-changed":"De machines die {tool} mogen gebruiken, werden gewijzigd.","tool-defaults-changed":"De standaard van {tool} werd gewijzigd.","tool-key-rotated":"{tool} kreeg een nieuwe key; de oude werkt niet meer.","tool-key-repaired":"{tool} werd opnieuw gekoppeld en kreeg een nieuwe key.","tool-revoked":"{tool} werd ingetrokken.","tool-reactivated":"{tool} werd opnieuw geactiveerd.","tool-removed":"Virtuele key {tool} werd verwijderd, met haar toekenningen.","grant-added":"{tool} mag nu {secret} gebruiken op {host}.","grant-changed":"De toekenning van {tool} voor {secret} op {host} werd gewijzigd.","grant-removed":"{tool} mag {secret} niet meer gebruiken op {host}.","new-passkey-added":"Er werd een passkey aan de kluis toegevoegd.","passkey-renamed":"Een passkey kreeg een nieuwe naam.","passkey-removed":"Er werd een passkey uit de kluis verwijderd.","passkey-prf-enrolled":"Een passkey kan nu de kluis openen.","settings-changed":"De instellingen werden gewijzigd.","step-up-confirmed":"Een wijziging werd bevestigd met een aanraking van je passkey.","vault-recovered":"De kluis werd hersteld met de herstelcode; er is een nieuwe passphrase.","tool-blocked":"{tool} werd geblokkeerd.","tool-unblocked":"{tool} werd weer vrijgegeven.","secret-blocked":"{secret} werd geblokkeerd.","secret-unblocked":"{secret} werd weer vrijgegeven.","grant-blocked":"De toekenning van {tool} voor {secret} op {host} werd geblokkeerd.","grant-unblocked":"De toekenning van {tool} voor {secret} op {host} werd weer vrijgegeven.","passkey-blocked":"Een passkey werd geblokkeerd.","passkey-unblocked":"Een passkey werd weer vrijgegeven.","notifications-snoozed":"Meldingen werden stilgezet.","grant-notifications-snoozed":"Meldingen voor één toekenning werden stilgezet.","tls-untrusted-accepted":"Je vertrouwde de certificaat-root voor {host}.","quiet-hours":"{tool} vroeg {secret} voor {host} tijdens de rustige uren. Tegengehouden; er werd niets ontsleuteld.","notifications-resumed":"Meldingen staan weer aan.","grant-notifications-resumed":"Meldingen voor één toekenning staan weer aan."},tray:{popup:{title:{approve:"Vaultgate: goedkeuring",device:"Vaultgate: tool koppelen",tunnel:"Vaultgate: TUNNEL"},header:{approve:"Nieuwe combinatie: toestaan?",device:"Een tool vraagt een key: koppelen?",tunnel:"Tunnel zonder invulling, zonder scrubbing: beveiligingsrisico",subdomain:"Een nieuw subdomein: aan dit secret toevoegen?"},field:{tool:"Tool",secret:"Secret",host:"Host",request:"Request",client:"Client"},new:"(nieuw)",typeCode:"Typ eerst de code uit je terminal in de koppelaanvraag in het Vaultgate-portaal; pas dan kun je het hier toestaan.",sensitive:"Gevoelig: daarna je passkey aanraken.",allowTimed:'"Toestaan" voor een tijd: daarna je passkey aanraken.',button:{deny:"Weigeren",once:"Eenmalig",allow:"Toestaan",always:"Altijd"},span:{"30m":"30 min","1h":"1 uur","4h":"4 uur",always:"altijd"},countdown:"verloopt over {seconds} s",arming:"(knoppen actief na 1,5 s)  ",timedOut:"verlopen: niets toegestaan",invalidHost:"(ongeldige host)",root:{same:"Dezelfde certificaat-root als het domein dat je toeliet (een aanwijzing, geen garantie).",different:"Een andere certificaat-root dan het domein dat je toeliet: wees voorzichtig.",unknown:"De certificaat-root kon niet nagekeken worden."}},menu:{tooltip:{locked:"kluis dicht",unlocked:"kluis open",pending:"({count} wachtend)"},vault:{locked:"Kluis: dicht",unlocked:"Kluis: open"},pending:"Wachtende goedkeuringen ({count})",lockNow:"Nu vergrendelen",logout:"Afmelden (kluis sluiten)",openPortal:"Portaal openen",disabledSuffix:" [uit]"},notify:{codeChanged:{title:"Vaultgate: bestanden veranderd",text:"De kluis blijft dicht: {files} veranderd. Kijk in het portaal."},delayed:{title:"Vaultgate: vertraagd",text:"Herhaalde foute pogingen ({actor}): {seconds} s geen antwoord."},used:{title:"Vaultgate: gebruikt",text:"{tool} gebruikte {secret} voor {host}"},actor:{tool:"tool {tool}",client:"van {client}"},passkeyAdded:{title:"Vaultgate: nieuwe passkey",text:"Er is een nieuwe passkey aan je kluis toegevoegd. Was jij dat niet? Verwijder hem bij Passkeys."},reuse:{title:"Vaultgate: gekopieerde key gezien",text:"Iemand gebruikte een oude key van {tool}. Vaultgate heeft de tool ingetrokken. Roteer haar key in het portaal en koppel opnieuw."},admin:{title:{portal:"Vaultgate: gewijzigd in het portaal",tray:"Vaultgate: gewijzigd vanuit de tray",device:"Vaultgate: gewijzigd door een gekoppelde tool",proxy:"Vaultgate: geleerd door de proxy",other:"Vaultgate: gewijzigd"},more:"Nog {count} zulke wijzigingen: {text}",rules:{other:"Een wijziging in je kluis ({rule}).","secret-added":"Secret {secret} toegevoegd.","secret-rotated":"De waarde van secret {secret} is vervangen.","secret-hosts-changed":"De domeinen van secret {secret} zijn gewijzigd.","secret-places-changed":"Waar secret {secret} in een request mag komen, is gewijzigd.","secret-sensitive-changed":'Secret {secret}: "gevoelig" is gewijzigd.',"secret-renamed":"Een secret heet nu {secret}.","secret-removed":"Secret {secret} verwijderd.","tool-added":"Nieuwe virtuele key: {tool}.","tool-renamed":"Een virtuele key heet nu {tool}.","tool-clients-changed":"De adressen van {tool} zijn gewijzigd.","tool-defaults-changed":"De standaarden van {tool} zijn gewijzigd.","tool-reask-changed":"Hoe vaak {tool} om je passkey vraagt, is gewijzigd.","tool-key-rotated":"De key van {tool} is geroteerd.","tool-key-repaired":"{tool} is opnieuw gekoppeld en kreeg een nieuwe key.","tool-revoked":"{tool} is ingetrokken.","tool-reactivated":"{tool} is opnieuw actief.","tool-removed":"{tool} verwijderd.","key-rotated":"{tool} kreeg automatisch een nieuwe key. Je hoeft niets te doen.","grant-added":"Nieuwe toekenning: {tool} mag {secret} gebruiken op {host}.","grant-changed":"Toekenning gewijzigd: {tool}, {secret} op {host}.","grant-removed":"Toekenning verwijderd: {tool}, {secret} op {host}.","passkey-renamed":"Een passkey heeft een nieuwe naam.","passkey-removed":"Een passkey is verwijderd.","new-passkey-added":"Er is een nieuwe passkey toegevoegd.","passkey-prf-enrolled":"Een passkey kan nu de kluis openen.","settings-changed":"De instellingen zijn gewijzigd.","tool-blocked":"Een virtuele key is geblokkeerd.","tool-unblocked":"Een virtuele key is niet meer geblokkeerd.","secret-blocked":"Secret {secret} is geblokkeerd.","secret-unblocked":"Secret {secret} is niet meer geblokkeerd.","grant-blocked":"Een toekenning voor {secret} op {host} is geblokkeerd.","grant-unblocked":"Een toekenning voor {secret} op {host} is niet meer geblokkeerd.","passkey-blocked":"Een passkey is geblokkeerd.","passkey-unblocked":"Een passkey is niet meer geblokkeerd.","notifications-snoozed":"Meldingen zijn stilgezet.","notifications-resumed":"Meldingen staan weer aan.","grant-notifications-snoozed":"Meldingen voor een toekenning zijn stilgezet.","grant-notifications-resumed":"Meldingen voor een toekenning staan weer aan.","vault-recovered":"De kluis is geopend met de herstelcode.","tls-chain-accepted":"Een nieuwe certificaatketen voor {host} wordt vertrouwd.","tls-untrusted-accepted":"Een nieuwe certificaatroot voor {host} wordt vertrouwd."}}}},cli:{login:{pairing:'"{name}" koppelen aan Vaultgate.',checkCode:`Jouw code: {code}
Open het Vaultgate-portaal, typ deze code in het koppelverzoek en sta het daarna toe met een aanraking van je passkey.`,waiting:"Wachten tot je het toestaat in Vaultgate...",requestFailed:"Vaultgate weigerde de aanvraag: {error}",badResponse:"Vaultgate: onverwacht antwoord (toolnaam of key)",pollError:"Vaultgate: {error}",saved:"Gekoppeld. De key staat in {file}"},key:{invalidName:"ongeldige toolnaam {name}",noSaved:'geen key voor {name}: draai eerst "node src/main.js login --name {name}"',invalidSaved:"het key-bestand voor {name} is geen Vaultgate tool-key",unreadable:'de key voor {name} gaat hier niet open (andere gebruiker of pc): draai opnieuw "node src/main.js login --name {name}"',exchangeFailed:"Vaultgate weigerde de uitwisseling van de key: {rule}"},portal:{opened:"Portaal geopend in een afgeschermd {browser}-venster (eigen profiel, zonder extensies).",extensions:"Let op: {count} extensie(s) in het profiel van het portaalvenster (groepsbeleid?)."}},errors:{VAULT_LOCKED:"De kluis is dicht.",DEVICE_CODE_INVALID:"De koppelcode klopt niet. Kijk naar de code in je terminal en typ ze opnieuw.",WRONG_CREDENTIALS:"Daarmee ging de kluis niet open.",TOO_MANY_ATTEMPTS:"Te veel pogingen. Wacht even en probeer opnieuw.",UNAUTHENTICATED:"Log eerst in.",VAULT_EXISTS:"Er is hier al een kluis.",PRF_REQUIRED:"Deze sleutel kan de kluis niet openen (geen PRF). Gebruik een security key, je telefoon of Windows Hello.",DUPLICATE_NAME:"Die naam bestaat al.",INVALID_NAME:"Gebruik letters, cijfers, _ . - (max. 64).",WEBAUTHN_FAILED:"De passkey kon niet gecontroleerd worden. Probeer opnieuw.",PASSKEY_CREATE_FAILED:"Het maken van de passkey is niet afgerond (gestopt na {seconds} s). Op een telefoon: scan de QR-code en bewaar de passkey in de app die de telefoon voorstelt. Probeer opnieuw, of kies een andere sleutel.",PASSKEY_PRF_FAILED:"De passkey is gemaakt, maar het lezen van de kluissleutel is niet afgerond (gestopt na {seconds} s). Je telefoon of app ondersteunt misschien de PRF-extensie niet die Vaultgate nodig heeft om de kluis te openen. Probeer een security key of deze pc.",VAULT_ROLLED_BACK:"Dit is een oudere kopie van de kluis. Bevestig in de waarschuwing hieronder als je ze bewust terugzette.",CODE_CHANGED:"Bestanden van Vaultgate zelf zijn veranderd. Bevestig in de waarschuwing hieronder als je het zelf bijwerkte of aanpaste.",STEP_UP_REQUIRED:"Raak je passkey aan om deze wijziging te bevestigen. Er is niets gewijzigd.",STEP_UP_CANCELLED:"Bevestigen met een aanraking is niet afgerond. Er is niets gewijzigd.",STEP_UP_UNAVAILABLE:"Geen passkey kan deze wijziging bevestigen (geblokkeerd, of niet toegestaan door de instelling voor aanraken). Er is niets gewijzigd.",LAST_PASSKEY:"Hou minstens één passkey die niet geblokkeerd is.",INVALID_QUIET_HOURS:"Gebruik vensters zoals 23:00-07:00 (24 u), één per regel."}};var nt=Object.freeze({en:st,nl:ot});var Le="vaultgate.lang",Na=["placeholder","title","aria-label"];function it(e,t="",s={}){for(let[o,n]of Object.entries(e))typeof n=="string"?s[t+o]=n:it(n,t+o+".",s);return s}var Q=Object.fromEntries(Object.entries(nt).map(([e,t])=>[e,it(t)])),Da=Object.freeze(Object.keys(Q)),Ia=()=>{try{return localStorage.getItem(Le)}catch{return null}};function lt(e=[Ia(),...navigator.languages??[navigator.language]]){for(let t of e){let s=String(t??"").toLowerCase().split("-")[0];if(Q[s])return s}return"en"}var H=lt();document.documentElement.lang=H;function Pe(e){try{e?localStorage.setItem(Le,e):localStorage.removeItem(Le)}catch{}H=lt(e?[e]:void 0),document.documentElement.lang=H,O(document.body)}function Va(e,t,s,o={}){return(e[t]?.[s]??e.en[s]??s).replace(/\{(\w+)\}/g,(r,d)=>d in o?String(o[d]):r)}var i=(e,t)=>Va(Q,H,e,t),q=e=>e in Q[H]||e in Q.en;function O(e){for(let t of e.querySelectorAll("[data-i18n]"))t.textContent=i(t.dataset.i18n);for(let t of Na)for(let s of e.querySelectorAll(`[data-i18n-${t}]`))s.setAttribute(t,i(s.getAttribute(`data-i18n-${t}`)))}var C=e=>e?new Date(e).toLocaleString(H):"",N=e=>e&&new Date(e).toDateString()===new Date().toDateString()?new Date(e).toLocaleTimeString(H,{hour:"2-digit",minute:"2-digit"}):C(e);var a=e=>document.getElementById(e);function g(e,t,s={},o={}){let n=e.querySelector(`template[data-template="${t}"]`);if(!n)throw new Error("missing template: "+t);let r=n.content.firstElementChild.cloneNode(!0),d=p=>[...r.matches(p)?[r]:[],...r.querySelectorAll(p)];for(let p of d("[data-if]"))s[p.dataset.if]||p.remove();for(let p of d("[data-if-not]"))s[p.dataset.ifNot]&&p.remove();for(let p of d("[data-field]")){let l=s[p.dataset.field];l instanceof Node?p.replaceChildren(l):p.textContent=l??""}for(let p of d('[data-testid*="{"]'))p.dataset.testid=p.dataset.testid.replace(/\{(\w+)\}/g,(l,k)=>String(s[k]??""));for(let p of d("[data-action]")){let l=o[p.dataset.action];l&&p.addEventListener("click",k=>v(l,k))}return O(r),r}function L(e,t="info"){a("message").replaceChildren(g(document,"message-"+t,{text:e}))}function qa(){a("message").replaceChildren()}var rt=0,dt=e=>{rt+=e,document.body.dataset.busy=String(rt)};function ct(e){return e.code&&q("errors."+e.code)?i("errors."+e.code,e.params):(e.code?e.code+": ":"")+e.message}async function v(e,t){dt(1);let s=t?.target?.closest?.("button"),o=s&&(s.querySelector('use[*|href="#i-touch"], use[href="#i-touch"]')||s.id==="kn-add");s&&o&&(s.disabled=!0,s.classList.add("touch-busy"),s.querySelector("svg")?.classList.add("touch-animating"));try{qa(),await e()}catch(n){L(ct(n),"error")}finally{s&&o&&(s.disabled=!1,s.classList.remove("touch-busy"),s.querySelector("svg")?.classList.remove("touch-animating")),dt(-1)}}var h=(e,t)=>a(e).addEventListener("click",s=>v(t,s));function M(e){let t=Object.keys(e),s=!1,o=n=>{if(s)return;s=!0;let r=t.map(a),d=a(n),p=[...d.childNodes];for(let l of r)l.disabled=!0;return d.setAttribute("aria-busy","true"),d.replaceChildren(g(document,"ceremony-busy")),v(async()=>{try{await e[n]()}finally{d.replaceChildren(...p),d.removeAttribute("aria-busy");for(let l of r)l.disabled=!1;s=!1}})};for(let n of t)a(n).addEventListener("click",()=>o(n))}var P=e=>e.split(/[\n,]/).map(t=>t.trim()).filter(Boolean);function D(e,t,s,o){let n=e.value;if(e.replaceChildren(),s&&e.append(new Option(typeof s=="string"?s:i("portal.common.all"),"")),o){let r=new Option(o,"");r.disabled=!0,e.append(r)}for(let[r,d]of t)e.append(new Option(r,d));[...e.options].some(r=>r.value===n&&!r.disabled)?e.value=n:o&&(e.value="")}var w=e=>String(e??"").replace(/^https:\/\//,"");function j(e,t){let s=document.querySelector(e)??document.createElement(e);return s.parentElement!==t&&t.append(s),s}function X(e){for(let t of e.querySelectorAll("[data-reveal]"))t.addEventListener("click",()=>{let s=t.closest(".join").querySelector("input");s.type=s.type==="password"?"text":"password",t.setAttribute("aria-pressed",String(s.type==="text"))})}var m=(e,{template:t="",wire:s,load:o})=>customElements.define(e,class extends HTMLElement{connectedCallback(){this.wired||(this.wired=!0,t&&(this.innerHTML=t,O(this)),s?.call(this))}load(){return o?o.call(this):Promise.resolve()}});var U=!1,G=null,ee=null,Ne=()=>{};async function De(){ee=null;let e;try{({ticket:e}=await _(()=>c("POST","/api/push/ticket")))}catch(t){if(!U)return;if(t.status===401||t.status===403){U=!1,Ne("lock");return}ee=setTimeout(De,2e3);return}U&&(G=new EventSource("/api/push?ticket="+encodeURIComponent(e)),G.onmessage=t=>Ne(t.data),G.onerror=()=>{G?.close(),G=null,U&&(ee=setTimeout(De,1e3))})}function pt(e){Ne=e,!U&&(U=!0,De())}function ut(){U=!1,clearTimeout(ee),ee=null,G?.close(),G=null}var z=null,ce="audit",ht=!1,kt="vaultgate.setupGuideDismissed",T=()=>z;function vt(e){return`vaultgate ${e.replaceAll("{proxy}","http://127.0.0.1:"+(z?.proxyPort??8484))}`}function te(e=document){for(let t of e.querySelectorAll("[data-cli]"))t.textContent=vt(t.dataset.cli)}var ae=()=>ce,S=e=>{ce=e};function Ve(){try{return localStorage.getItem(kt)==="1"}catch{return!1}}function qe(){try{localStorage.setItem(kt,"1")}catch{}}var pe=e=>{ht=e},Oa=["welcome","recovery","login","unlock","main"];function K(e){for(let t of Oa)a("view-"+t).classList.toggle("hidden",t!==e);a("menu").classList.toggle("hidden",e!=="main")}var ft=e=>document.dispatchEvent(new CustomEvent("vault-state",{detail:e})),Oe=()=>ft({kind:"open",lockInMs:0});async function se(){z=await c("GET","/api/state"),te(),ft({kind:z.vaultExists?z.unlocked?"open":"locked":"none",lockInMs:z.lockInMs??0})}var gt=["audit","tools","secrets","grants","passkeys","settings"],Ra=Object.freeze({audit:["audit"],approvals:["audit"],device:["audit","tools"],admin:gt,settings:gt.slice(1)}),Ie=null,re=new Set,de=new Set,yt=()=>!!document.querySelector("dialog[open]"),Ha=()=>ce==="tools"&&!a("tools-create-card").classList.contains("hidden"),Ma=e=>Ra[e]?.includes(ce)&&!(e==="admin"&&Ha());function bt(e){if(e==="lock"){_(f).catch(()=>{});return}re.add(e),!Ie&&(Ie=_(async()=>{for(;re.size;){let t=[...re].filter(Ma);re.clear(),await se();let s=a("view-main");t.length===0||s.classList.contains("hidden")||(yt()?t.forEach(o=>de.add(o)):await s.load())}}).catch(()=>{}).finally(()=>{Ie=null}))}document.addEventListener("close",()=>{if(de.size===0||yt())return;let e=[...de];de.clear(),e.forEach(bt)},!0);var mt=!1;async function Ga(){if(mt)return;mt=!0;let e=typeof window<"u"?window.location?.hash??"":"",t=/^#session=([A-Za-z0-9_-]+)$/.exec(e);if(t){try{window.history?.replaceState?.(null,"",window.location.pathname+window.location.search)}catch{}try{await c("POST","/api/session/redeem",{ticket:t[1]})}catch{}}}async function f(){return await Ga(),await se(),z.loggedIn?pt(bt):ut(),a("lock").classList.toggle("hidden",!(z.loggedIn&&z.unlocked)),a("logout").classList.toggle("hidden",!z.loggedIn),a("rollback").classList.toggle("hidden",!(z.rolledBack&&!z.unlocked)),await a("integrity").load(),!z.vaultExists||ht?(K("welcome"),a("view-welcome").load()):z.loggedIn?z.unlocked?(K("main"),a("view-main").load()):(K("unlock"),a("view-unlock").load()):(K("login"),a("view-login").load())}var Ua=e=>btoa(String.fromCharCode(...new Uint8Array(e))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""),Re=e=>Uint8Array.from(atob(e.replace(/-/g,"+").replace(/_/g,"/")),t=>t.charCodeAt(0));function ue(e){let t=e.toJSON();return t.clientExtensionResults&&delete t.clientExtensionResults.prf,t}var ge=e=>{let t=e.getClientExtensionResults().prf?.results?.first;return t?Ua(t):void 0};async function xt(e,t){let s=Date.now();try{return await t()}catch(o){throw["NotAllowedError","AbortError","TimeoutError"].includes(o?.name)?Object.assign(new Error(o.message),{code:"PASSKEY_"+e+"_FAILED",params:{seconds:Math.round((Date.now()-s)/1e3)}}):o}}async function wt(e,t){let s=PublicKeyCredential.parseRequestOptionsFromJSON(e);return s.extensions={prf:{eval:{first:Re(t)}}},xt("PRF",()=>navigator.credentials.get({publicKey:s}))}async function He(e,{first:t=!1}={}){let s=t?"/api/setup/passkey":"/api/webauthn/register",{options:o,prfSalt:n}=await c("POST",s+"/options",e?{attachment:e}:{}),r=PublicKeyCredential.parseCreationOptionsFromJSON(o);r.extensions={prf:{eval:{first:Re(n)}}};let d=await xt("CREATE",()=>navigator.credentials.create({publicKey:r})),p=d.getClientExtensionResults().prf?.enabled,l=await c("POST",s+"/verify",{response:ue(d),prfOutput:ge(d)});if(t&&l.needsPrf){let k=await wt(l.options,l.prfSalt);await c("POST","/api/setup/passkey/prf",{response:ue(k),prfOutput:ge(k)}),l.prf=!0}else if(!t&&!l.prf&&p){let k=await c("POST","/api/webauthn/prf-enroll/options",{credentialId:l.credentialId,prfSalt:l.prfSalt}),y=await wt(k.options,l.prfSalt),b=await c("POST","/api/webauthn/prf-enroll/verify",{response:ue(y),prfSalt:l.prfSalt,prfOutput:ge(y)});l.prf=b.prf}L(l.prf||t?i("portal.passkeys.registered"):i("portal.passkeys.registeredNoPrf"),"success")}async function J(e,t={}){let{options:s,prfSalts:o}=await c("POST","/api/webauthn/login/options"),n=PublicKeyCredential.parseRequestOptionsFromJSON(s);e&&(n.hints=[e]);let r={};for(let[p,l]of Object.entries(o))r[p]={first:Re(l)};Object.keys(r).length&&(n.extensions={prf:{evalByCredential:r}});let d=await navigator.credentials.get({publicKey:n});await c("POST","/api/webauthn/login/verify",{...t,response:ue(d),prfOutput:ge(d)})}async function Me(e){let t="/api/touch/"+encodeURIComponent(e);try{let{options:s}=await c("POST",t+"/options"),o=await navigator.credentials.get({publicKey:PublicKeyCredential.parseRequestOptionsFromJSON(s)});return await c("POST",t+"/verify",{response:o.toJSON()}),!0}catch{try{await c("POST",t+"/deny")}catch{}return!1}}var Ka=(e,t)=>e.replace(/\r\n/g,`
`)===t.replace(/\r\n/g,`
`);async function Wa(e){try{return await e.readText()}catch{return null}}async function Y(e,{clipboard:t=navigator.clipboard,setTimer:s=setTimeout,onFocus:o=n=>window.addEventListener("focus",n,{once:!0})}={}){await t.writeText(e);let n=async()=>{let r=await Wa(t);r!==null&&!Ka(r,e)||await t.writeText("").catch(()=>o(n))};s(n,6e4)}var Ge=e=>e.matches('button, [role="option"]')?e:e.querySelector("button")??e;function A(e,t,s,{keyOf:o,render:n,empty:r}){let d=({row:y,item:b})=>{e.dataset.selected=o(b);for(let u of s)Ge(u.row).setAttribute("aria-selected",String(u.row===y));t.replaceChildren(n(b))};for(let y of s){let b=Ge(y.row);b.setAttribute("aria-selected","false"),b.addEventListener("click",()=>d(y)),!b.matches("button")&&(Object.assign(b,{tabIndex:0}),b.setAttribute("role","option"),b.addEventListener("keydown",u=>{(u.key==="Enter"||u.key===" ")&&(u.preventDefault(),d(y))}))}let p=e.dataset.firstKey,l=s[0]?o(s[0].item):"";e.dataset.firstKey=l,p&&l&&p!==l&&s[0]&&Ge(s[0].row).classList.add("row-enter"),e.replaceChildren(...s.map(y=>y.row));let k=s.find(y=>o(y.item)===e.dataset.selected)??s[0];k?d(k):t.replaceChildren(...r?[r()]:[])}var Ue="vaultgate.theme",Tt=new Set(["dracula","console-light"]);function me(){try{let e=localStorage.getItem(Ue)??"";return Tt.has(e)?e:""}catch{return""}}var jt=e=>{e?document.documentElement.dataset.theme=e:delete document.documentElement.dataset.theme};function Ke(e){let t=Tt.has(e)?e:"";try{t?localStorage.setItem(Ue,t):localStorage.removeItem(Ue)}catch{}jt(t)}jt(me());var St=`<!-- Pictogrammen (eigen, lijnstijl), één keer in de pagina; elders <svg><use href="#i-..."/></svg>. Het merkteken: een sluis. -->
<svg width="0" height="0" class="absolute" aria-hidden="true">
  <symbol id="i-gate" viewBox="0 0 24 24"><path d="M5 3v18M19 3v18M5 12h14M15 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-key" viewBox="0 0 24 24"><circle cx="8" cy="15" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="i-touch" viewBox="0 0 24 24"><path d="M12 11v4M8 9a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0M5 9a7 7 0 0 1 14 0v5a7 7 0 0 1-14 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></symbol>
  <symbol id="i-bot" viewBox="0 0 24 24"><rect x="4" y="8" width="16" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4v4M9 13h.01M15 13h.01" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></symbol>
  <symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" fill="none" stroke="currentColor" stroke-width="2"/></symbol>
  <symbol id="i-plug" viewBox="0 0 24 24"><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="i-phone" viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 18h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="i-laptop" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 19h20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="i-bell" viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12l5 5 9-10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="i-lock" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></symbol>
  <symbol id="i-link" viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="i-gear" viewBox="0 0 24 24"><path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 13v-2l2.1-.5a6.1 6.1 0 0 1 .7-1.6L5.7 7.1l1.4-1.4 1.8 1.1a6.1 6.1 0 0 1 1.6-.7L11 4h2l.5 2.1a6.1 6.1 0 0 1 1.6.7l1.8-1.1 1.4 1.4-1.1 1.8c.3.5.5 1 .7 1.6L20 11v2l-2.1.5a6.1 6.1 0 0 1-.7 1.6l1.1 1.8-1.4 1.4-1.8-1.1a6.1 6.1 0 0 1-1.6.7L13 20h-2l-.5-2.1a6.1 6.1 0 0 1-1.6-.7l-1.8 1.1-1.4-1.4 1.1-1.8a6.1 6.1 0 0 1-.7-1.6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></symbol>
  <symbol id="i-warn" viewBox="0 0 24 24"><path d="M12 4l9 16H3zM12 10v4M12 17h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-power" viewBox="0 0 24 24"><path d="M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="i-eye" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></symbol>
  <symbol id="i-user" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21a8 8 0 0 1 16 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="i-edit" viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></symbol>
  <symbol id="i-rotate" viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-trash" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="i-cert" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="15" cy="15" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13.5 17.5L13 22l2-1 2 1-.5-4.5M7 8h6M7 11h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></symbol>
  <symbol id="i-chain-ok" viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="i-chain-broken" viewBox="0 0 24 24"><path d="M15 9l3-3a3 3 0 0 0-4.2-4.2L11 4.6M9 15l-3 3a3 3 0 0 0 4.2 4.2L13 19.4M4 4l3 3M20 20l-3-3M9 2v3M2 9h3M15 22v-3M22 15h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
  <symbol id="i-ban" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></symbol>
</svg>
`;m("ks-icons",{template:St});var Ct=`<dialog id="ask-dialog" class="modal" data-testid="ask-dialog" aria-labelledby="ask-question">
  <div class="modal-box">
    <form id="ask-form" method="dialog">
      <h3 id="ask-question" class="font-bold text-lg" data-testid="ask-question"></h3>
      <div id="ask-warning" role="alert" class="alert alert-warning alert-soft mt-3 hidden" data-testid="ask-warning"><svg class="size-5" aria-hidden="true"><use href="#i-warn"/></svg><span id="ask-warning-text"></span></div>
      <ul id="ask-items" class="mt-3 space-y-1 hidden" data-testid="ask-items"></ul>
      <div id="ask-field" class="join w-full mt-4 hidden">
        <input id="ask-input" type="text" class="input join-item w-full hidden" autocomplete="off" spellcheck="false" aria-labelledby="ask-question" data-testid="ask-input">
        <button type="button" class="btn join-item hidden" data-reveal data-testid="ask-reveal" data-i18n-aria-label="portal.ask.show"><svg class="size-4" aria-hidden="true"><use href="#i-eye"/></svg></button>
      </div>
      <div class="modal-action">
        <button type="button" id="ask-cancel" class="btn btn-ghost" data-testid="ask-cancel" data-i18n="portal.ask.cancel"></button>
        <button type="submit" id="ask-ok" value="ok" class="btn btn-primary" data-testid="ask-ok"></button>
      </div>
    </form>
  </div>
  <form method="dialog" class="modal-backdrop"><button tabindex="-1" data-i18n="portal.ask.cancel"></button></form>
</dialog>

<template data-template="item">
  <li class="rounded bg-base-200 px-2 py-1" data-testid="ask-item">
    <div class="font-mono text-xs break-all" data-field="text"></div>
    <div class="text-xs muted break-all" data-if="note" data-field="note"></div>
  </li>
</template>
`;var We=null,Be=e=>{let t=We;We=null,a("ask-input").value="",t?.(e)};m("ks-ask",{template:Ct,wire(){let e=a("ask-dialog");a("ask-cancel").addEventListener("click",()=>e.close("")),X(this),e.addEventListener("close",()=>{let t=a("ask-input");e.returnValue!=="ok"?Be(null):Be(t.classList.contains("hidden")?!0:t.value)})}});function x(e,{input:t,value:s="",ok:o="portal.ask.ok",warning:n="",items:r=[],cancel:d=!0}={}){Be(null),a("ask-items").replaceChildren(...r.map(k=>g(document.querySelector("ks-ask"),"item",k))),a("ask-items").classList.toggle("hidden",!r.length),a("ask-cancel").classList.toggle("hidden",!d);let p=a("ask-dialog"),l=a("ask-input");return a("ask-question").textContent=e,a("ask-ok").textContent=i(o),a("ask-warning-text").textContent=n,a("ask-warning").classList.toggle("hidden",!n),l.classList.toggle("hidden",!t),a("ask-field").classList.toggle("hidden",!t),a("ask-dialog").querySelector("[data-reveal]").classList.toggle("hidden",t!=="password"),l.type=t==="password"?"password":"text",l.autocomplete=t==="password"?"new-password":"off",l.value=t==="password"?"":s,p.returnValue="",new Promise(k=>{We=k,p.showModal(),t&&l.focus()})}var zt=`<template data-template="paused">
  <span class="flex flex-wrap items-center gap-1">
    <span class="badge badge-sm badge-soft badge-warning gap-1" data-testid="{id}-until"><svg class="size-3" aria-hidden="true"><use data-icon href="#i-lock"/></svg><span data-field="text"></span></span>
    <button type="button" class="btn btn-sm btn-ghost gap-1" data-action="resume" data-testid="{id}-resume"><svg class="size-4" aria-hidden="true" data-touch><use href="#i-touch"/></svg><span data-field="resume"></span></button>
  </span>
</template>
<template data-template="choose">
  <details class="dropdown dropdown-end">
    <summary class="btn btn-sm btn-ghost gap-1" data-testid="{id}"><svg class="size-4" aria-hidden="true"><use data-icon href="#i-lock"/></svg><span data-field="label"></span></summary>
    <ul class="dropdown-content menu z-50 mt-1 p-2 shadow bg-base-100 rounded-box w-52 border border-base-content/10">
      <li><button type="button" data-action="15m" data-testid="{id}-15m" data-i18n="portal.pause.15m"></button></li>
      <li><button type="button" data-action="1h" data-testid="{id}-1h" data-i18n="portal.pause.1h"></button></li>
      <li><button type="button" data-action="tomorrow" data-testid="{id}-tomorrow" data-i18n="portal.pause.tomorrow"></button></li>
      <li data-if="forever"><button type="button" data-action="forever" data-testid="{id}-forever" data-i18n="portal.pause.forever"></button></li>
    </ul>
  </details>
</template>
`;var Et=6e4,$a=(e=new Date)=>new Date(e.getFullYear(),e.getMonth(),e.getDate()+1).getTime(),Ja=Object.freeze({"15m":()=>Date.now()+15*Et,"1h":()=>Date.now()+60*Et,tomorrow:()=>$a(),forever:()=>null}),Ya=Object.freeze({block:{label:"portal.pause.block",until:"portal.pause.blockedUntil",forever:"portal.pause.blockedForever",resume:"portal.pause.unblock",icon:"#i-lock"},silence:{label:"portal.pause.silence",until:"portal.pause.silencedUntil",resume:"portal.pause.unsilence",icon:"#i-bell"}}),Za=e=>e===null||e!==void 0&&e>Date.now();m("ks-pause",{template:zt,wire(){let{id:e,kind:t,until:s,pause:o,resume:n}=this.options,r=Ya[t],d=Za(s)?g(this,"paused",{id:e,text:s===null?i(r.forever):i(r.until,{time:N(s)}),resume:i(r.resume)},{resume:n}):g(this,"choose",{id:e,label:i(r.label),forever:t==="block"},Object.fromEntries(Object.entries(Ja).map(([p,l])=>[p,()=>o(l())])));d.querySelector("[data-icon]").setAttribute("href",r.icon),d.querySelector("[data-touch]")?.classList.toggle("hidden",t!=="block"),this.append(d)}});function oe(e){let t=document.createElement("ks-pause");return t.options=e,t}function R(e,t,s,o){let n=t.find(r=>Object.entries(s).every(([d,p])=>r[d]===p));return oe({id:e,kind:"block",until:n?n.until??null:void 0,pause:async r=>{await c("POST","/api/blocks",{...s,until:r}),await o()},resume:async()=>{await c("DELETE","/api/blocks/"+n.id),await o()}})}var At=`<nav class="menu-bar" data-i18n-aria-label="portal.menu.label">
  <button type="button" class="menu-pill" data-tab="audit" data-testid="tab-audit"><svg class="menu-pill-icon" aria-hidden="true"><use href="#i-bell"/></svg><span data-i18n="portal.tabs.activity"></span></button>
  <button type="button" class="menu-pill" data-tab="tools" data-testid="tab-tools"><svg class="menu-pill-icon" aria-hidden="true"><use href="#i-bot"/></svg><span data-i18n="portal.tabs.keys"></span><span class="menu-pill-wait" data-wait="tools" data-testid="menu-wait-tools" data-i18n-title="portal.menu.waits"></span></button>
  <button type="button" class="menu-pill" data-tab="secrets" data-testid="tab-secrets"><svg class="menu-pill-icon" aria-hidden="true"><use href="#i-shield"/></svg><span data-i18n="portal.tabs.secrets"></span></button>
  <button type="button" class="menu-pill" data-tab="grants" data-testid="tab-grants"><svg class="menu-pill-icon" aria-hidden="true"><use href="#i-check"/></svg><span data-i18n="portal.tabs.grants"></span></button>
  <button type="button" class="menu-pill" data-tab="tls" data-testid="tab-tls"><svg class="menu-pill-icon" aria-hidden="true"><use href="#i-cert"/></svg><span data-i18n="portal.tabs.certificates"></span><span class="menu-pill-wait" data-wait="tls" data-testid="menu-wait-tls" data-i18n-title="portal.menu.waits"></span></button>
  <button type="button" class="menu-pill" data-tab="passkeys" data-testid="tab-passkeys"><svg class="menu-pill-icon" aria-hidden="true"><use href="#i-touch"/></svg><span data-i18n="portal.tabs.passkeys"></span></button>
  <button type="button" class="menu-pill" data-tab="settings" data-testid="tab-settings"><svg class="menu-pill-icon" aria-hidden="true"><use href="#i-gear"/></svg><span data-i18n="portal.tabs.settings"></span></button>
</nav>
`;function Xa(e,t){for(let s of e.querySelectorAll("[data-tab]"))s.dataset.tab===t?s.setAttribute("aria-current","page"):s.removeAttribute("aria-current")}m("ks-menu",{template:At,wire(){for(let e of this.querySelectorAll("[data-tab]"))e.addEventListener("click",()=>v(async()=>{S(e.dataset.tab),await a("view-main").load()}));document.addEventListener("tab-shown",e=>Xa(this,e.detail.tab))}});function ne(e,t){let s=document.querySelector(`ks-menu [data-wait="${e}"]`);s&&(s.textContent=t?String(t):"")}var Lt=`<div class="flex items-center gap-2 shrink-0"><svg class="size-7 text-primary" aria-hidden="true"><use href="#i-gate"/></svg><span class="text-xl font-bold" translate="no">Vaultgate</span></div>
<ks-menu id="menu" class="hidden"></ks-menu>
<div class="session-bar" role="group" data-testid="session" data-i18n-aria-label="portal.header.session">
  <span id="vault-state" class="tooltip tooltip-left" data-testid="vault-state"></span>
  <button id="lock" class="btn btn-sm btn-outline gap-1 hidden" data-testid="lock" data-i18n-title="portal.header.lockTip"><svg class="size-4" aria-hidden="true"><use href="#i-lock"/></svg><span data-i18n="portal.header.lock"></span></button>
  <button id="logout" class="btn btn-sm btn-ghost btn-square hidden" data-testid="logout" data-i18n-aria-label="portal.header.logout" data-i18n-title="portal.header.logoutTip"><svg class="size-4" aria-hidden="true"><use href="#i-power"/></svg></button>
</div>
<template data-template="state-none"><span class="session-status"><span data-i18n="portal.header.noVault"></span></span></template>
<template data-template="state-locked"><span class="session-status"><svg class="size-4" aria-hidden="true"><use href="#i-lock"/></svg><span data-i18n="portal.header.locked"></span></span></template>
<template data-template="state-open"><span class="session-status"><svg class="size-4" aria-hidden="true"><use href="#i-clock"/></svg><span data-field="text"></span></span></template>
`;var ve=0,he=null,ke=()=>{},ts=()=>Math.max(1,Math.ceil((ve-Date.now())/6e4));function as(e,{kind:t,lockInMs:s=0}){let o=a("vault-state");if(o.dataset.state=t,clearInterval(he),he=null,t!=="open"){o.replaceChildren(g(e,"state-"+t));return}ve=Date.now()+s;let n=()=>s?i("portal.header.openFor",{minutes:ts()}):i("portal.header.open");ke=()=>o.replaceChildren(g(e,"state-open",{text:n()})),ke(),s&&(he=setInterval(()=>Date.now()>=ve?v(f):ke(),15e3))}m("ks-header",{template:Lt,wire(){a("vault-state").dataset.tip=i("portal.header.timerTip"),document.addEventListener("vault-state",e=>as(this,e.detail)),document.addEventListener("session-active",e=>{he&&(ve=Date.now()+e.detail.lockInMs,ke())}),h("lock",async()=>{await c("POST","/api/lock"),$(),await f()}),h("logout",async()=>{await c("POST","/api/logout"),$(),await f()})}});var Pt=`<!-- De MCP in de agents van deze pc zetten, of de JSON kopiëren. De agent krijgt \`--name\`, nooit de key. -->\r
<div class="space-y-5" data-testid="mcp-install">\r
  <p class="text-sm muted" data-i18n="portal.mcpInstall.help"></p>\r
\r
  <!-- 1. Waar: voor alle mappen of één map -->\r
  <section class="space-y-2" data-testid="mcp-scope-selector">\r
    <h4 class="text-xs font-semibold uppercase tracking-wider muted" data-i18n="portal.mcpInstall.whereTitle"></h4>\r
    <div class="join w-full">\r
      <input type="radio" name="mcp-scope" value="user" id="mi-scope-user" checked class="join-item btn btn-sm flex-1" data-i18n-aria-label="portal.mcpInstall.scopeUser" data-testid="mcp-scope-user-radio" />\r
      <input type="radio" name="mcp-scope" value="project" id="mi-scope-project" class="join-item btn btn-sm flex-1" data-i18n-aria-label="portal.mcpInstall.scopeProject" data-testid="mcp-scope-project-radio" />\r
    </div>\r
    <div id="mi-folder-box" class="hidden" data-testid="mcp-folder-box">\r
      <input type="text" id="mi-folder-input" class="input input-sm w-full font-mono text-xs" data-testid="mcp-folder-input" />\r
    </div>\r
  </section>\r
\r
  <!-- 2. De agents op deze pc: één rij per agent, met waar hij al staat -->\r
  <section class="space-y-2">\r
    <div class="flex items-center justify-between gap-2">\r
      <h4 class="text-xs font-semibold uppercase tracking-wider muted" data-i18n="portal.mcpInstall.agentsTitle"></h4>\r
      <button type="button" id="mi-refresh" class="btn btn-xs btn-ghost" data-testid="mcp-refresh" data-i18n="portal.mcpInstall.refresh"></button>\r
    </div>\r
    <ul id="mi-agents" class="space-y-2" data-testid="mcp-agents"></ul>\r
    <p id="mi-none" class="text-sm muted hidden" data-testid="mcp-none" data-i18n="portal.mcpInstall.none"></p>\r
    <p id="mi-refresh-status" class="text-xs muted" data-testid="mcp-refresh-status"></p>\r
  </section>\r
\r
  <!-- 3. Skill en policy -->\r
  <section class="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] p-3" data-testid="mcp-skill-section">\r
    <div>\r
      <p class="text-sm font-medium" data-i18n="portal.mcpInstall.skillTitle"></p>\r
      <p class="text-xs muted" data-i18n="portal.mcpInstall.skillHelp"></p>\r
    </div>\r
    <div class="flex shrink-0 items-center gap-2">\r
      <span id="mi-skill-status" class="text-xs muted" data-testid="mcp-skill-status"></span>\r
      <button type="button" id="mi-skill-install" class="btn btn-sm btn-outline" data-testid="mcp-skill-install" data-i18n="portal.mcpInstall.installSkill"></button>\r
      <button type="button" id="mi-skill-uninstall" class="btn btn-sm btn-ghost text-error" data-testid="mcp-skill-uninstall" data-i18n="portal.mcpInstall.uninstallSkill"></button>\r
    </div>\r
  </section>\r
\r
  <!-- 4. Een andere agent: de JSON zelf plakken -->\r
  <section class="flex flex-wrap items-center justify-between gap-2">\r
    <p class="text-sm muted" data-i18n="portal.mcpInstall.otherAgent"></p>\r
    <div class="flex items-center gap-2">\r
      <div class="join">\r
        <button type="button" id="mi-copy" class="join-item btn btn-sm" data-testid="mcp-copy-json" data-i18n="portal.mcpInstall.copyJson"></button>\r
        <button type="button" id="mi-copy-vscode" class="join-item btn btn-sm" data-testid="mcp-copy-json-vscode" data-i18n="portal.mcpInstall.copyJsonVscode"></button>\r
      </div>\r
      <a id="mi-status-link" href="/mcp" target="_blank" rel="noopener noreferrer" class="link text-xs muted" data-testid="mcp-status-link"><span data-i18n="portal.mcpInstall.statusPage"></span> <span aria-hidden="true">↗</span></a>\r
    </div>\r
  </section>\r
</div>\r
\r
<template data-template="agent">\r
  <li class="rounded-lg border border-[var(--line)] bg-base-200 px-3 py-2" data-testid="mcp-agent-{id}">\r
    <div class="flex items-center justify-between gap-3">\r
      <span class="font-medium text-sm" data-field="label"></span>\r
      <span class="flex items-center gap-2">\r
        <span class="text-xs muted" data-role="status" data-testid="mcp-status-{id}"></span>\r
        <button type="button" class="btn btn-sm btn-primary" data-action="install" data-testid="mcp-install-{id}" data-i18n="portal.mcpInstall.install"></button>\r
        <button type="button" class="btn btn-sm btn-ghost text-error hidden" data-action="uninstall" data-testid="mcp-uninstall-{id}" data-i18n="portal.mcpInstall.uninstall"></button>\r
      </span>\r
    </div>\r
    <ul class="mt-1 space-y-1" data-role="places"></ul>\r
  </li>\r
</template>\r
\r
<template data-template="installation-row">\r
  <li class="flex items-center justify-between gap-2 text-xs" data-testid="mcp-installation-item">\r
    <span class="truncate"><span class="muted" data-field="scopeLabel"></span> <span class="font-mono" data-field="displayPath"></span> <span class="text-error" data-field="missing"></span></span>\r
    <button type="button" class="btn btn-xs btn-ghost text-error" data-if="project" data-action="remove-install" data-i18n="portal.mcpInstall.uninstall"></button>\r
  </li>\r
</template>\r
`;var W=null,fe=null,ie=null;function ye(e=[]){e.length&&x(i("portal.mcpInstall.changedTitle"),{items:e.map(t=>({text:t.file,...t.backup?{note:i("portal.mcpInstall.backupNote",{path:t.backup})}:{}})),cancel:!1})}var os=()=>{let e=a("mi-scope-project")?.checked,t=e?a("mi-folder-input")?.value?.trim():null;return{scope:e?"project":"user",...t?{folder:t}:{}}},ns=e=>i("portal.mcpInstall.status."+e.status)+(e.reason?` (${e.reason})`:"");async function Fe(){if(!fe||!ie)return;let e=await c("GET",`/api/mcp/installations?tool=${encodeURIComponent(fe)}`).catch(()=>({installations:[]})),t=Object.groupBy(e?.installations||[],s=>s.agent);for(let s of a("mi-agents").children){let o=t[s.dataset.agent]||[];s.querySelector('[data-role="places"]').replaceChildren(...o.map(n=>g(ie,"installation-row",{scopeLabel:n.scope==="project"?i("portal.mcpInstall.scopeProject"):i("portal.mcpInstall.scopeUser"),displayPath:n.scope==="project"?n.folder:n.file,missing:n.status==="missing"?`(${i("portal.mcpInstall.missing")})`:"",project:n.scope==="project"},{"remove-install":async()=>{let{changed:r}=await c("POST","/api/mcp/uninstall",{key:W,agents:[n.agent],scope:n.scope,folder:n.folder});await Fe(),ye(r)}})))}}function is(e){let t=g(ie,"agent",e,{install:()=>o("install"),uninstall:()=>o("uninstall")});t.dataset.agent=e.id;let s=n=>{t.querySelector('[data-action="install"]').classList.toggle("hidden",n),t.querySelector('[data-action="uninstall"]').classList.toggle("hidden",!n)};async function o(n){let{results:[r],changed:d}=await c("POST",`/api/mcp/${n}`,{key:W,agents:[e.id],...os()});t.querySelector('[data-role="status"]').textContent=ns(r),["installed","updated","unchanged"].includes(r.status)&&s(!0),["removed","absent"].includes(r.status)&&s(!1),await Fe(),ye(d)}return e.installed&&(t.querySelector('[data-role="status"]').textContent=i("portal.mcpInstall.status.installed"),s(!0)),t}async function Nt(e){let{results:t,changed:s}=await c("POST",`/api/mcp/skill/${e}`,{key:W}),o=e==="install"?["installed","updated"]:["removed"],n=t.some(r=>o.includes(r.status))?e==="install"?"installed":"removed":e==="install"?"unchanged":"absent";a("mi-skill-status").textContent=i("portal.mcpInstall.status."+n),ye(s)}async function be({auto:e=!1}={}){let t=await c("POST","/api/mcp/refresh",e?{auto:!0}:{});a("mi-refresh-status")&&!e&&(a("mi-refresh-status").textContent=t.files.length?"":i("portal.mcpInstall.refreshNothing")),ye(t.files)}m("ks-mcp-install",{template:Pt,wire(){h("mi-copy",async()=>{await Y(JSON.stringify(await c("POST","/api/mcp/entry",{key:W}),null,2)),a("mi-copy").textContent=i("portal.keys.copied")}),h("mi-copy-vscode",async()=>{await Y(JSON.stringify(await c("POST","/api/mcp/entry",{key:W,format:"vscode"}),null,2)),a("mi-copy-vscode").textContent=i("portal.keys.copied")}),h("mi-skill-install",()=>Nt("install")),h("mi-skill-uninstall",()=>Nt("uninstall")),h("mi-refresh",()=>be()),h("mi-scope-user",()=>a("mi-folder-box")?.classList.add("hidden")),h("mi-scope-project",()=>{a("mi-folder-box")?.classList.remove("hidden"),a("mi-folder-input")?.focus()})}});function Dt(){W=null,fe=null}async function It(e,t){ie=j("ks-mcp-install",e),W=t,a("mi-copy").textContent=i("portal.mcpInstall.copyJson"),a("mi-copy-vscode").textContent=i("portal.mcpInstall.copyJsonVscode"),a("mi-folder-input").placeholder=i("portal.mcpInstall.folderPlaceholder"),fe=(await c("GET","/api/tools").catch(()=>[])).find(r=>r.kind==="mcp")?.name||null;let o=(await c("GET","/api/mcp/agents")).filter(r=>r.present);a("mi-agents").replaceChildren(...o.map(is)),a("mi-none").classList.toggle("hidden",o.length>0);let n=await c("GET","/api/state").catch(()=>null);return n?.proxyPort&&(a("mi-status-link").href=`http://127.0.0.1:${n.proxyPort}/mcp`),await Fe(),ie}var Vt=`<!-- De key één keer, en wat de tool nodig heeft. Eén element in de pagina: bij aanmaken in de stap, bij Rotate in de dialoog. -->\r
<div class="space-y-3">\r
  <div id="kr-key-part" class="space-y-3">\r
  <div class="key-box" data-testid="t-key-box">\r
    <div class="flex items-center justify-between gap-3">\r
      <p class="font-medium"><span data-i18n="portal.keys.keyTitle"></span> <span class="muted font-normal" data-i18n="portal.keys.keyOnce"></span></p>\r
      <button type="button" id="kr-copy-key" class="btn btn-sm btn-ghost" data-testid="key-copy" data-i18n="portal.keys.copy"></button>\r
    </div>\r
    <code id="kr-key" class="block font-mono mt-2 break-all text-sm" data-testid="t-key" translate="no"></code>\r
  </div>\r
  <p id="kr-copied-note" class="text-sm muted hidden" data-testid="key-copied-note" data-i18n="portal.keys.copiedNote"></p>\r
  </div>\r
  <div class="flex items-center justify-between gap-3">\r
    <p class="font-medium" data-i18n="portal.keys.configTitle"></p>\r
    <button type="button" id="kr-copy-config" class="btn btn-sm btn-ghost" data-testid="config-copy" data-i18n="portal.keys.copy"></button>\r
  </div>\r
  <div id="kr-config" data-testid="key-config"></div>\r
  <div class="flex justify-end"><button type="button" id="kr-done" class="btn btn-primary" data-testid="key-done" data-i18n="portal.keys.gotIt"></button></div>\r
</div>\r
\r
<template data-template="web">\r
  <div class="config-box" translate="no">\r
    <pre data-prefix="#"><code data-i18n="portal.keys.configAnthropic"></code></pre>\r
    <pre data-prefix="$"><code>ANTHROPIC_BASE_URL=<span data-field="proxy"></span>/anthropic</code></pre>\r
    <pre data-prefix="$"><code>ANTHROPIC_API_KEY=<span data-field="key"></span></code></pre>\r
    <pre data-prefix="#"><code data-i18n="portal.keys.configForward"></code></pre>\r
    <pre data-prefix="$"><code>curl <span data-field="proxy"></span>/forward/https://api.example.com/ -H "x-vault-gate-tool-key: <span data-field="key"></span>" -H "Authorization: Bearer {{secret:<span data-field="secret"></span>}}"</code></pre>\r
  </div>\r
</template>\r
`;var rs=()=>[...a("kr-config").querySelectorAll('pre:not([data-prefix="#"])')].map(e=>e.textContent).join(`
`),qt=async(e,t)=>{await Y(t),a(e).textContent=i("portal.keys.copied"),a("kr-copied-note").classList.remove("hidden")};function V(){let e=document.querySelector("ks-key-reveal");if(e){a("kr-key").textContent="",a("kr-config").replaceChildren(),Dt();for(let t of["kr-copy-key","kr-copy-config"])a(t).textContent=i("portal.keys.copy");a("kr-copied-note").classList.add("hidden"),e.classList.add("hidden")}}m("ks-key-reveal",{template:Vt,wire(){h("kr-copy-key",()=>qt("kr-copy-key",a("kr-key").textContent)),h("kr-copy-config",()=>qt("kr-copy-config",rs())),h("kr-done",()=>{V(),this.dispatchEvent(new CustomEvent("key-done",{bubbles:!0}))})}});function we(e,{key:t,kind:s,secret:o="github_token"}){let n=j("ks-key-reveal",e);V();let r=T(),d={proxy:"http://127.0.0.1:"+r.proxyPort,key:t,secret:o,main:r.mainScript??"src/main.js"};a("kr-key").textContent=t;for(let p of["kr-key-part","kr-copy-config"])a(p).classList.toggle("hidden",s==="mcp");return s==="mcp"?v(()=>It(a("kr-config"),t)):a("kr-config").replaceChildren(g(n,"web",d)),n.classList.remove("hidden"),n}var Ot=`<!-- Een virtuele key maken, in de drie stappen van de mockups onder elkaar: naam, soort, en hoe de tool haar key krijgt.
     Eén kolom: het past in de dialoog van Virtual keys en in de kolom van het welkom. -->
<div class="flex flex-col gap-6">
  <div class="step-block">
    <span class="step-num">1</span>
    <div class="flex-1 space-y-2">
      <label class="step-title block" for="kn-name" data-i18n="portal.keyCreate.nameTitle"></label>
      <input id="kn-name" class="input w-full font-mono" placeholder="claude-code" data-testid="t-name">
      <p class="step-help" data-i18n="portal.keyCreate.nameHelp"></p>
    </div>
  </div>
  <div class="step-block">
    <span class="step-num">2</span>
    <fieldset class="flex-1 space-y-2">
      <legend class="step-title" data-i18n="portal.keyCreate.kindTitle"></legend>
      <div class="grid grid-cols-2 gap-3" role="radiogroup">
        <button type="button" class="choice-card" data-kind="web" data-testid="kf-kind-web" role="radio"><svg class="size-5 shrink-0" aria-hidden="true"><use href="#i-globe"/></svg><span><span class="block font-medium" data-i18n="portal.keys.kindWeb"></span><span class="block text-sm muted" data-i18n="portal.keyCreate.webHelp"></span></span></button>
        <button type="button" class="choice-card" data-kind="mcp" data-testid="kf-kind-mcp" role="radio"><svg class="size-5 shrink-0" aria-hidden="true"><use href="#i-plug"/></svg><span><span class="block font-medium" data-i18n="portal.keys.kindMcp"></span><span class="block text-sm muted" data-i18n="portal.keyCreate.mcpHelp"></span></span></button>
      </div>
    </fieldset>
  </div>
  <div class="step-block min-w-0">
    <span class="step-num">3</span>
    <div class="flex-1 min-w-0 space-y-3">
      <p class="step-title" data-i18n="portal.keyCreate.giveTitle"></p>
      <div data-kind-panel="web" class="grid grid-cols-2 gap-3" role="tablist">
        <button type="button" role="tab" class="choice-card" data-way="pair" data-testid="key-way-pair"><svg class="size-5 shrink-0" aria-hidden="true"><use href="#i-link"/></svg><span><span class="block font-medium"><span data-i18n="portal.keyCreate.wayAuto"></span> <span class="tag tag-signal" data-i18n="portal.welcome.wayBest"></span></span><span class="block text-sm muted" data-i18n="portal.keyCreate.wayAutoHelp"></span></span></button>
        <button type="button" role="tab" class="choice-card" data-way="manual" data-testid="key-way-manual"><svg class="size-5 shrink-0" aria-hidden="true"><use href="#i-key"/></svg><span><span class="block font-medium" data-i18n="portal.keyCreate.wayManual"></span><span class="block text-sm muted" data-i18n="portal.keyCreate.wayManualHelp"></span></span></button>
      </div>
      <div data-way-panel="pair" class="rounded-lg border border-[var(--line)] bg-base-200 p-4 space-y-3" data-testid="key-pair">
        <p class="text-sm" data-i18n="portal.keyCreate.pairRun"></p>
        <div class="join w-full" translate="no"><code id="kn-pair-cmd" class="join-item flex-1 min-w-0 border border-[var(--line-2)] bg-base-300 px-3 py-2 font-mono text-sm break-words" data-testid="key-pair-command" data-cli="login --name claude-code --proxy {proxy}"></code><button type="button" id="kn-copy-cmd" class="btn join-item" data-testid="key-pair-copy" data-i18n="portal.keys.copy"></button></div>
        <p class="text-sm" data-i18n="portal.keyCreate.pairCheck"></p>
        <div id="kn-device-slot"></div>
        <div id="kn-paired" role="status" class="note note-signal hidden" data-testid="key-paired"><svg aria-hidden="true"><use href="#i-check"/></svg><span id="kn-paired-text"></span></div>
        <!-- Alleen om te zien welke tool er nieuw bij kwam (ook na toestaan in de tray); de lijst zelf staat bij Virtual keys. -->
        <div id="kn-tools-slot" hidden></div>
      </div>
      <div data-way-panel="manual" class="rounded-lg border border-[var(--line)] bg-base-200 p-4 space-y-3 hidden">
        <div id="kn-form" class="space-y-3">
        <p class="text-sm muted" data-kind-panel="web" data-i18n="portal.welcome.manualHelp"></p>
        <p class="text-sm muted" data-kind-panel="mcp" data-i18n="portal.keyCreate.mcpCreateHelp"></p>
        <details><summary class="cursor-pointer text-sm muted" data-i18n="portal.keys.otherMachines"></summary>
          <fieldset class="fieldset"><label class="label" for="kn-clients" data-i18n="portal.keys.clients"></label><input id="kn-clients" placeholder="192.168.56.10" class="input w-full" data-testid="t-clients"></fieldset>
        </details>
        <div class="flex justify-end"><button id="kn-add" type="button" class="btn btn-primary gap-2" data-testid="t-add"><svg class="size-4" aria-hidden="true"><use href="#i-touch"/></svg><span data-i18n="portal.keys.create"></span></button></div>
        </div>
        <div id="kn-reveal-slot"></div>
      </div>
    </div>
  </div>
</div>
`;var cs=1500,_e=null,B=()=>{clearInterval(_e),_e=null},ps=()=>a("kn-name").value.trim()||"claude-code";function Ht(e,t){a("kn-paired-text").textContent=i("portal.welcome.paired",{name:t}),a("kn-paired").classList.remove("hidden"),e.dispatchEvent(new CustomEvent("tool-connected",{bubbles:!0,detail:{name:t}}))}async function us(e){let t=j("ks-device-list",a("kn-device-slot")),s=j("ks-paired-tools",a("kn-tools-slot")),o=new Set,n=async()=>(await Promise.all([s.load(),t.load()]))[0];for(let r of await n())o.add(r.id);_e=setInterval(()=>{if(e.offsetParent===null){B();return}n().then(r=>{for(let d of r)o.has(d.id)||(o.add(d.id),Ht(e,d.name))}).catch(()=>{})},cs)}function Rt(e,t,s,o){for(let n of e)n.setAttribute(o,String(n.dataset[t]===s))}m("ks-key-create",{template:Ot,wire(){this.kind="web",this.way="pair";for(let e of this.querySelectorAll("[data-kind]"))e.addEventListener("click",()=>v(async()=>{this.kind=e.dataset.kind,await this.load()}));for(let e of this.querySelectorAll("[data-way]"))e.addEventListener("click",()=>v(async()=>{this.way=e.dataset.way,await this.load()}));a("kn-name").addEventListener("input",()=>{a("kn-pair-cmd").dataset.cli=`login --name ${ps()} --proxy {proxy}`,te(this)}),this.addEventListener("tool-paired",e=>Ht(this,e.detail.name)),this.addEventListener("key-done",()=>a("kn-form").classList.remove("hidden")),h("kn-copy-cmd",async()=>{await navigator.clipboard.writeText(a("kn-pair-cmd").textContent),a("kn-copy-cmd").textContent=i("portal.keys.copied")}),h("kn-add",async()=>{let e=a("kn-add"),t=e.querySelector("svg");e.disabled=!0,e.classList.add("touch-busy"),t?.classList.add("touch-animating");try{let s=a("kn-name").value.trim(),o=await c("POST","/api/tools",{name:s,clients:P(a("kn-clients").value),kind:this.kind});a("kn-name").value=a("kn-clients").value="",a("kn-form").classList.add("hidden"),we(a("kn-reveal-slot"),{key:o.key,kind:this.kind}),this.dispatchEvent(new CustomEvent("key-created",{bubbles:!0,detail:{id:o.id,name:s,kind:this.kind}}))}finally{e.disabled=!1,e.classList.remove("touch-busy"),t?.classList.remove("touch-animating")}})},async load(){B(),a("kn-reveal-slot").contains(document.querySelector("ks-key-reveal"))&&V(),a("kn-form").classList.remove("hidden");let e=this.kind==="mcp"?"manual":this.way;Rt(this.querySelectorAll("[data-kind]"),"kind",this.kind,"aria-checked"),Rt(this.querySelectorAll("[data-way]"),"way",e,"aria-selected");for(let t of this.querySelectorAll("[data-kind-panel]"))t.classList.toggle("hidden",t.dataset.kindPanel!==this.kind);for(let t of this.querySelectorAll("[data-way-panel]"))t.classList.toggle("hidden",t.dataset.wayPanel!==e);te(this),e==="pair"&&await us(this)}});var Mt=`<div class="welcome-tile flex h-full flex-col overflow-hidden" data-layout="focus">
  <!-- Kop: de vier stappen en een voortgangslijn (de sluis vult mee); het merk staat al in de kopbalk erboven. -->
  <header class="flex-none border-b border-[var(--line)] bg-base-100 px-8 pt-4 pb-4">
    <div class="lock-rail" aria-hidden="true"><i id="wl-rail-fill"></i></div>
    <ol class="mt-2 grid grid-cols-4 text-sm" data-testid="welcome-steps">
      <li data-step="1" data-i18n="portal.welcome.stepWelcome"></li><li data-step="2" data-i18n="portal.welcome.stepPasskeys"></li><li data-step="3" data-i18n="portal.welcome.stepKey"></li><li data-step="4" data-i18n="portal.welcome.stepDone"></li>
    </ol>
  </header>

  <div id="wl-pages" class="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-12">
    <!-- Stap 1: wat Vaultgate doet, in drie zinnen. -->
    <section data-page="1" class="focus-col py-8">
      <h1 class="screen-title"><span data-i18n="portal.welcome.promise1"></span> <span data-i18n="portal.welcome.promise2"></span></h1>
      <p class="mt-2 ink-2" data-i18n="portal.welcome.pitch"></p>
      <ol class="panel rows mt-7">
        <li class="flex items-start gap-4 px-5 py-4"><span class="step-num">1</span><div><p class="font-medium" data-i18n="portal.welcome.how1"></p><p class="text-sm muted" data-i18n="portal.welcome.how1Text"></p></div></li>
        <li class="flex items-start gap-4 px-5 py-4"><span class="step-num">2</span><div><p class="font-medium" data-i18n="portal.welcome.how2"></p><p class="text-sm muted" data-i18n="portal.welcome.how2Text"></p></div></li>
        <li class="flex items-start gap-4 px-5 py-4"><span class="step-num">3</span><div><p class="font-medium" data-i18n="portal.welcome.how3"></p><p class="text-sm muted" data-i18n="portal.welcome.how3Text"></p></div></li>
      </ol>
      <p class="mt-4 text-sm muted" data-i18n="portal.welcome.tagline"></p>
      <div class="focus-foot"><p class="text-sm muted" data-i18n="portal.welcome.duration"></p><button id="wl-start" class="btn btn-primary" data-testid="welcome-start" data-i18n="portal.welcome.start"></button></div>
    </section>

    <!-- Stap 2: passkeys die de kluis openen; minstens twee. -->
    <section data-page="2" class="focus-col py-7 hidden">
      <h1 class="screen-title" data-i18n="portal.welcome.keysTitle"></h1>
      <p class="mt-1 ink-2" data-i18n="portal.welcome.keysIntro"></p>
      <div class="panel mt-5"><div id="wl-passkeys-slot"></div><div id="wl-passkey-add-slot" class="border-t border-[var(--line)] p-4"></div></div>
      <p class="note note-warn mt-4 hidden" data-testid="welcome-two-keys"><svg aria-hidden="true"><use href="#i-warn"/></svg><span><b class="font-medium" data-i18n="portal.welcome.twoKeysTitle"></b> <span data-i18n="portal.welcome.twoKeysText"></span></span></p>
      <div class="toast toast-end toast-top mt-20 toast-fade hidden" data-testid="welcome-vault-created"><div class="note note-signal"><svg aria-hidden="true"><use href="#i-lock"/></svg><span data-i18n="portal.welcome.vaultCreated"></span></div></div>
      <div class="focus-foot"><button class="btn btn-ghost btn-sm" data-back="1" data-i18n="portal.welcome.back"></button><button id="wl-passkeys-next" class="btn btn-primary" disabled data-testid="welcome-passkeys-next" data-i18n="portal.welcome.next"></button></div>
    </section>

    <!-- Stap 3: de eerste tool en haar virtuele key (hetzelfde component als "Create key" bij Virtual keys). -->
    <section data-page="3" class="focus-col py-6 pb-12 hidden">
      <h1 class="screen-title" data-i18n="portal.welcome.keyTitle"></h1>
      <p class="mt-1 ink-2" data-i18n="portal.welcome.keyIntro"></p>
      <!-- Het pad van elke request, met de tool (waar je nu bent) gemarkeerd. -->
      <div class="mt-4 flex flex-wrap items-center gap-3 text-sm" data-testid="welcome-path">
        <span class="muted" data-i18n="portal.welcome.pathTitle"></span>
        <span class="chain"><span class="chain-link is-new"><svg aria-hidden="true"><use href="#i-bot"/></svg><span data-i18n="portal.welcome.pathTool"></span></span><span class="chain-sep">→</span><span class="chain-link"><svg aria-hidden="true"><use href="#i-gate"/></svg><span translate="no">Vaultgate</span></span><span class="chain-sep">→</span><span class="chain-link"><svg aria-hidden="true"><use href="#i-globe"/></svg><span data-i18n="portal.welcome.pathDomain"></span></span></span>
      </div>
      <div id="wl-ways-slot" class="mt-5"></div>
      <div class="focus-foot"><button class="btn btn-ghost btn-sm" data-back="2" data-i18n="portal.welcome.back"></button><div class="flex gap-3"><button id="wl-key-skip" class="btn btn-ghost" data-testid="welcome-key-skip" data-i18n="portal.welcome.skip"></button><button id="wl-key-next" class="btn btn-primary hidden" data-testid="welcome-key-next" data-i18n="portal.welcome.next"></button></div></div>
    </section>

    <!-- Stap 4: klaar, en wat je daarna doet. -->
    <section data-page="4" class="focus-col py-8 hidden">
      <div class="touch-orb w-fit" data-tone="success"><svg class="size-8" aria-hidden="true"><use href="#i-check"/></svg></div>
      <h1 class="screen-title mt-5" data-i18n="portal.welcome.doneTitle"></h1>
      <ul class="mt-4 space-y-2.5">
        <li class="flex items-start gap-2.5"><svg class="mt-0.5 size-4 shrink-0 text-[var(--ok)]" aria-hidden="true"><use href="#i-check"/></svg><span id="wl-sum-passkeys" data-testid="welcome-summary-passkeys"></span></li>
        <li class="flex items-start gap-2.5"><svg class="mt-0.5 size-4 shrink-0 text-[var(--ok)]" aria-hidden="true"><use href="#i-check"/></svg><span id="wl-sum-tools" data-testid="welcome-summary-tools"></span></li>
        <li class="flex items-start gap-2.5"><svg class="mt-0.5 size-4 shrink-0 text-[var(--ok)]" aria-hidden="true"><use href="#i-check"/></svg><span data-i18n="portal.welcome.doneEncrypted"></span></li>
      </ul>
      <ks-security-specs class="mt-3 block"></ks-security-specs>
      <p class="section-label mt-7" data-i18n="portal.welcome.doneNext"></p>
      <div class="panel rows">
        <div class="flex items-center gap-3 px-4 py-3"><span class="row-icon"><svg aria-hidden="true"><use href="#i-lock"/></svg></span><div class="flex-1"><p class="font-medium" data-i18n="portal.welcome.nextSecret"></p><p class="text-sm muted" data-i18n="portal.welcome.nextSecretText"></p></div></div>
        <div class="flex items-center gap-3 px-4 py-3"><span class="row-icon"><svg aria-hidden="true"><use href="#i-bot"/></svg></span><div class="flex-1"><p class="font-medium" data-i18n="portal.welcome.nextGrant"></p><p class="text-sm muted" data-i18n="portal.welcome.nextGrantText"></p></div></div>
      </div>
      <div class="focus-foot"><button class="btn btn-ghost btn-sm" data-back="3" data-i18n="portal.welcome.back"></button><button id="wl-finish" class="btn btn-primary" data-testid="welcome-finish" data-i18n="portal.welcome.finish"></button></div>
    </section>
  </div>
</div>
`;function ms(e,t){return document.documentElement.classList.toggle("welcome-back",e),globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches||!document.startViewTransition?t():document.startViewTransition(t).updateCallbackDone}m("ks-welcome",{template:Mt,wire(){this.page=1;let e=s=>ms(s<this.page,async()=>{this.page=s,await f()});h("wl-start",async()=>{pe(!0),await e(2)}),h("wl-passkeys-next",()=>e(3)),h("wl-key-skip",()=>e(4)),h("wl-key-next",()=>e(4)),h("wl-finish",async()=>{B(),pe(!1),qe(),S("audit"),this.page=1,await f()});for(let s of this.querySelectorAll("[data-back]"))s.addEventListener("click",()=>v(()=>e(Number(s.dataset.back))));this.addEventListener("passkeys-changed",()=>v(()=>f()));let t=()=>a("wl-key-next").classList.remove("hidden");this.addEventListener("key-created",t),this.addEventListener("tool-connected",t)},async load(){let e=this.page;if(this.querySelectorAll("[data-page]").forEach(t=>t.classList.toggle("hidden",Number(t.dataset.page)!==e)),this.querySelectorAll('[data-testid="welcome-steps"] [data-step]').forEach(t=>{t.dataset.reached=String(Number(t.dataset.step)<=e)}),a("wl-rail-fill").style.setProperty("--fill",`${e*25}%`),this.dataset.current=String(e),B(),e===2){j("ks-passkey-add",a("wl-passkey-add-slot"));let t=j("ks-passkey-list",a("wl-passkeys-slot"));await t.load();let s=Number(t.dataset.count);a("wl-passkeys-next").disabled=s===0,this.querySelector('[data-testid="welcome-two-keys"]').classList.toggle("hidden",s>=2),this.querySelector('[data-testid="welcome-vault-created"]').classList.toggle("hidden",!(this.keyCount===0&&s>0)),this.keyCount=s}e===3&&await j("ks-key-create",a("wl-ways-slot")).load(),e===4&&await hs()}});async function hs(){let[e,t]=await Promise.all([c("GET","/api/passkeys"),c("GET","/api/tools")]);a("wl-sum-passkeys").textContent=e.length===1?i("portal.welcome.donePasskeysOne"):i("portal.welcome.donePasskeys",{count:e.length}),a("wl-sum-tools").textContent=t.length?i("portal.welcome.doneTools",{names:t.map(s=>s.name).join(", ")}):i("portal.welcome.doneNoTools")}var Gt=`<div class="card bg-base-100 shadow-sm mx-auto max-w-md"><div class="card-body">
  <h1 class="card-title screen-title" data-i18n="portal.recovery.title"></h1>
  <p data-i18n="portal.recovery.text"></p>
  <div id="recovery-code" class="rounded-box bg-neutral text-neutral-content p-3 font-mono break-all" data-testid="recovery-code"></div>
  <fieldset class="fieldset"><label class="label" for="recovery-confirm" data-i18n="portal.recovery.confirm"></label><input id="recovery-confirm" class="input w-40 font-mono uppercase" maxlength="4" autocomplete="off" data-testid="recovery-confirm"></fieldset>
  <div class="card-actions"><button id="recovery-done" class="btn btn-primary" disabled data-testid="recovery-done" data-i18n="portal.recovery.done"></button></div>
</div></div>
`;m("ks-recovery",{template:Gt,wire(){a("recovery-confirm").addEventListener("input",()=>{let e=a("recovery-code").textContent.replace(/-/g,"");a("recovery-done").disabled=a("recovery-confirm").value.trim().toUpperCase()!==e.slice(-4)}),h("recovery-done",async()=>{a("recovery-code").textContent="",a("recovery-confirm").value="",a("recovery-done").disabled=!0,S("passkeys"),await f()})}});var Ut=`<div class="flex min-h-[70vh] flex-col items-center justify-center gap-5 py-6">
<div class="flex items-center gap-2 text-[22px] font-semibold"><svg class="size-7 text-[var(--signal)]" aria-hidden="true"><use href="#i-gate"/></svg><span translate="no">Vaultgate</span></div>
<div class="focus-card items-center text-center" data-layout="focus">
  <div class="touch-orb w-fit"><svg class="size-10" aria-hidden="true"><use href="#i-touch"/></svg></div>
  <h1 class="screen-title" data-i18n="portal.login.title"></h1>
  <p id="login-passkey-text" class="text-sm ink-2" data-i18n="portal.login.passkeyText"></p>
  <button id="login-go" class="btn btn-primary btn-lg w-full" data-testid="login-go" data-i18n="portal.login.go"></button>
  <div id="login-bootstrap" class="hidden w-full text-left">
    <p class="text-sm muted" data-i18n="portal.login.bootstrapText"></p>
    <fieldset class="fieldset"><label class="label" for="bootstrap-pass" data-i18n="portal.common.passphrase"></label><input id="bootstrap-pass" type="password" class="input w-full" data-testid="bootstrap-pass"></fieldset>
    <button id="bootstrap-go" class="btn btn-primary" data-testid="bootstrap-go" data-i18n="portal.common.unlock"></button>
  </div>
  <details id="login-recover" class="w-full text-left hidden"><summary class="cursor-pointer text-sm muted" data-i18n="portal.login.lost"></summary>
    <fieldset class="fieldset">
      <label class="label" for="recover-code" data-i18n="portal.login.recoveryCode"></label><input id="recover-code" class="input w-full font-mono" data-testid="recover-code">
      <label class="label" for="recover-pass" data-i18n="portal.login.newPassphrase"></label><input id="recover-pass" type="password" class="input w-full" data-testid="recover-pass">
    </fieldset>
    <button id="recover-go" class="btn btn-sm mt-2" data-testid="recover-go" data-i18n="portal.login.recover"></button>
  </details>
</div>
<p id="login-start-over" class="max-w-[52ch] text-center text-sm muted hidden" data-testid="login-start-over" data-i18n="portal.login.startOver"></p>
</div>
`;var Kt=`<div role="alert" class="alert alert-warning alert-soft items-start">
  <svg class="size-6" aria-hidden="true"><use href="#i-warn"/></svg>
  <div class="space-y-2">
    <h3 class="font-bold" data-i18n="portal.rollback.title"></h3>
    <p data-i18n="portal.rollback.text"></p>
    <label class="label cursor-pointer gap-2"><input id="rollback-accept" type="checkbox" class="checkbox checkbox-warning" data-testid="rollback-accept"><span data-i18n="portal.rollback.accept"></span></label>
  </div>
</div>
`;m("ks-rollback",{template:Kt});var xe=()=>a("rollback-accept")?.checked===!0;var Wt=`<div role="alert" class="alert alert-error alert-soft items-start">
  <svg class="size-6" aria-hidden="true"><use href="#i-warn"/></svg>
  <div class="space-y-2">
    <h3 class="font-bold" data-i18n="portal.integrity.title"></h3>
    <p data-i18n="portal.integrity.text"></p>
    <ul id="integrity-files" class="list-disc pl-5 font-mono text-sm break-all" translate="no" data-testid="integrity-files"></ul>
    <label class="label cursor-pointer gap-2 whitespace-normal"><input id="integrity-accept" type="checkbox" class="checkbox checkbox-error" data-testid="integrity-accept"><span data-i18n="portal.integrity.accept"></span></label>
  </div>
</div>
`;m("ks-integrity",{template:Wt,async load(){let e=T().unlocked?[]:T().codeChanged??[];this.classList.toggle("hidden",e.length===0),a("integrity-files").replaceChildren(...e.map(t=>Object.assign(document.createElement("li"),{textContent:t})))}});var Te=()=>a("integrity-accept")?.checked===!0;var Bt=()=>({acceptRollback:xe(),acceptCodeChange:Te()});m("ks-login",{template:Ut,wire(){M({"login-go":async()=>{await J(void 0,Bt()),await f()}}),h("bootstrap-go",async()=>{try{await c("POST","/api/unlock",{passphrase:a("bootstrap-pass").value,...Bt()}),a("bootstrap-pass").value="",S("passkeys")}finally{await f()}}),h("recover-go",async()=>{let{recoveryCode:e}=await c("POST","/api/recover",{recoveryCode:a("recover-code").value,newPassphrase:a("recover-pass").value});a("recover-code").value=a("recover-pass").value="",Oe(),a("recovery-code").textContent=e,K("recovery")})},async load(){let e=T(),t=e.credentialCount>0;a("login-bootstrap").classList.toggle("hidden",t||!e.hasPassphrase);for(let s of["login-go","login-passkey-text"])a(s).classList.toggle("hidden",!t);a("login-recover").classList.toggle("hidden",!e.hasRecovery),a("login-start-over").classList.toggle("hidden",e.hasRecovery)}});var Ft=`<div class="flex min-h-[70vh] flex-col items-center justify-center gap-5 py-6">
  <div class="flex items-center gap-2 text-[22px] font-semibold"><svg class="size-7 text-[var(--signal)]" aria-hidden="true"><use href="#i-gate"/></svg><span translate="no">Vaultgate</span></div>
  <div class="focus-card" data-layout="focus">
    <div class="touch-orb mx-auto w-fit"><svg class="size-10" aria-hidden="true"><use href="#i-lock"/></svg></div>
    <div class="text-center">
      <h1 class="screen-title" data-i18n="portal.unlock.title"></h1>
      <p class="mt-2 text-sm ink-2" data-i18n="portal.unlock.passkeyText"></p>
    </div>
    <div id="unlock-passkey" class="flex flex-col gap-2">
      <button id="unlock-passkey-go" class="btn btn-primary btn-lg w-full gap-2" data-testid="unlock-passkey-go"><svg class="size-5" aria-hidden="true"><use href="#i-touch"/></svg><span data-i18n="portal.unlock.passkeyGo"></span></button>
      <div class="border-t border-[var(--line)] pt-4"><button id="unlock-phone-go" class="btn btn-outline w-full gap-2" data-testid="unlock-phone-go"><svg class="size-4" aria-hidden="true"><use href="#i-phone"/></svg><span data-i18n="portal.unlock.phoneGo"></span></button></div>
    </div>
    <!-- Alleen een oudere kluis met een passphrase; een kluis met alleen passkeys heeft er geen. -->
    <div id="unlock-passphrase" class="w-full space-y-2 border-t border-[var(--line)] pt-4 text-left">
      <p class="text-sm muted" data-i18n="portal.unlock.passphraseText"></p>
      <fieldset class="fieldset"><label class="label" for="unlock-pass" data-i18n="portal.common.passphrase"></label><input id="unlock-pass" type="password" class="input w-full" data-testid="unlock-pass"></fieldset>
      <button id="unlock-go" class="btn btn-outline" data-testid="unlock-go" data-i18n="portal.common.unlock"></button>
    </div>
  </div>
  <p class="max-w-[52ch] text-center text-sm muted" data-testid="unlock-start-over" data-i18n="portal.login.startOver"></p>
</div>
`;m("ks-unlock",{template:Ft,wire(){let e=()=>({acceptRollback:xe(),acceptCodeChange:Te()});M({"unlock-passkey-go":async()=>{await J(void 0,e()),await f()},"unlock-phone-go":async()=>{await J("hybrid",e()),await f()}}),h("unlock-go",async()=>{try{await c("POST","/api/unlock",{passphrase:a("unlock-pass").value,...e()}),a("unlock-pass").value=""}finally{await f()}})},async load(){a("unlock-passphrase").classList.toggle("hidden",!T().hasPassphrase),a("unlock-passkey").classList.toggle("hidden",T().passkeyCount===0)}});var _t=`<ks-wizard id="wizard" class="hidden block" data-testid="wizard"></ks-wizard>
<ks-tls id="tls-box" class="hidden block space-y-2" data-testid="tls-box"></ks-tls>
<ks-audit id="tab-audit" class="tab-panel block space-y-4"></ks-audit>
<ks-tools id="tab-tools" class="tab-panel block space-y-4 hidden"></ks-tools>
<ks-secrets id="tab-secrets" class="tab-panel block space-y-4 hidden"></ks-secrets>
<ks-grants id="tab-grants" class="tab-panel block space-y-4 hidden"></ks-grants>
<ks-tls-tab id="tab-tls" class="tab-panel block space-y-4 hidden"></ks-tls-tab>
<ks-passkeys id="tab-passkeys" class="tab-panel block space-y-4 hidden"></ks-passkeys>
<ks-settings id="tab-settings" class="tab-panel block space-y-4 hidden"></ks-settings>
`;m("ks-main",{template:_t,async load(){document.dispatchEvent(new CustomEvent("tab-shown",{detail:{tab:ae()}})),this.querySelectorAll(".tab-panel").forEach(s=>s.classList.toggle("hidden",s.id!=="tab-"+ae()));let[e,t]=await Promise.all([c("GET","/api/device"),c("GET","/api/tls")]);ne("tools",e.length),ne("tls",t.length),await Promise.all([a("wizard").load(),a("tls-box").load(),a("tab-"+ae()).load()])}});var $t=`<!-- Getting started (v23): één paneel, de vier stappen op een rij (gedaan: vinkje, open: nummer), de volgende stap en één knop. -->
<section class="panel" aria-labelledby="wizard-title">
  <div class="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
    <h2 id="wizard-title" class="text-sm font-medium" data-i18n="portal.wizard.title"></h2>
    <ol class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid="wizard-steps">
      <li class="wizard-step" data-step="passkey"><span class="wizard-mark" aria-hidden="true"><svg><use href="#i-check"/></svg><b>1</b></span><span data-i18n="portal.wizard.passkey"></span></li>
      <li class="wizard-step" data-step="tool"><span class="wizard-mark" aria-hidden="true"><svg><use href="#i-check"/></svg><b>2</b></span><span data-i18n="portal.wizard.key"></span></li>
      <li class="wizard-step" data-step="secret"><span class="wizard-mark" aria-hidden="true"><svg><use href="#i-check"/></svg><b>3</b></span><span data-i18n="portal.wizard.secret"></span></li>
      <li class="wizard-step" data-step="grant"><span class="wizard-mark" aria-hidden="true"><svg><use href="#i-check"/></svg><b>4</b></span><span data-i18n="portal.wizard.firstCall"></span></li>
    </ol>
    <div class="ml-auto flex items-center gap-3">
      <p id="wizard-next" class="text-sm ink-2" data-testid="wizard-next"></p>
      <button id="wizard-go" class="btn btn-primary btn-sm" data-testid="wizard-go"></button>
    </div>
  </div>
  <div id="wizard-config" class="hidden space-y-2 border-t border-[var(--line)] px-4 py-3" data-testid="wizard-config">
    <p class="text-sm muted" data-i18n="portal.wizard.checkIntro"></p>
    <div class="grid grid-cols-1 gap-3 md:grid-cols-4 md:items-end">
      <fieldset class="fieldset"><label class="label" for="wz-tool" data-i18n="portal.common.virtualKey"></label><select id="wz-tool" class="select select-sm" data-testid="wz-tool"></select></fieldset>
      <fieldset class="fieldset"><label class="label" for="wz-secret" data-i18n="portal.common.secret"></label><select id="wz-secret" class="select select-sm" data-testid="wz-secret"></select></fieldset>
      <button id="wz-check" class="btn btn-sm btn-outline" data-testid="wz-check" data-i18n="portal.wizard.check"></button>
      <div id="wz-result" class="md:col-span-4" data-testid="wz-result"></div>
    </div>
  </div>
</section>
<template data-template="result-success"><p role="status" class="note note-signal"><span><span class="stamp stamp-pass" data-field="rule" translate="no"></span> <span data-field="text"></span></span></p></template>
<template data-template="result-warning"><p role="status" class="note"><span><span class="stamp stamp-shield" data-field="rule" translate="no"></span> <span data-field="text"></span></span></p></template>
<template data-template="result-error"><p role="status" class="note note-warn"><span><span class="stamp stamp-shield" data-field="rule" translate="no"></span> <span data-field="text"></span></span></p></template>
`;var Ts={granted:"success","needs-approval":"warning"};m("ks-wizard",{template:$t,wire(){h("wizard-go",async()=>{S(this.dataset.tab),await a("view-main").load()}),h("wz-check",async()=>{let e=await c("POST","/api/check",{toolId:a("wz-tool").value,secretName:a("wz-secret").value}),t="portal.wizard.result."+e.rule;a("wz-result").replaceChildren(g(this,"result-"+(Ts[e.rule]??"error"),{rule:e.rule,text:q(t)?i(t):""})),a("wz-result").dataset.rule=e.rule})},async load(){let[e,t,s]=await Promise.all([c("GET","/api/secrets"),c("GET","/api/tools"),c("GET","/api/grants")]),o={passkey:T().credentialCount>=1,tool:t.length>0,secret:e.length>0,grant:s.length>0};this.classList.toggle("hidden",Ve()||o.passkey&&o.grant),this.querySelectorAll("[data-step]").forEach(d=>{d.dataset.done=String(o[d.dataset.step])});let[n,r]=o.passkey?o.tool?o.secret?["grant","grants"]:["secret","secrets"]:["key","tools"]:["passkey","passkeys"];a("wizard-next").textContent=i("portal.wizard.next."+n),a("wizard-go").textContent=i("portal.wizard.go."+n),this.dataset.tab=r,a("wizard-config").classList.toggle("hidden",!(o.secret&&o.tool)),o.secret&&o.tool&&(D(a("wz-tool"),t.map(d=>[d.name,d.id])),D(a("wz-secret"),e.map(d=>[d.name,d.name])))}});var Jt=`<template data-template="change">
  <div role="alert" class="alert alert-error alert-soft flex flex-col gap-3 p-4" data-testid="tls-alert-{host}">
    <div class="flex items-center justify-between gap-4 w-full flex-wrap">
      <div class="flex items-center gap-2">
        <svg class="size-5 text-error shrink-0" aria-hidden="true"><use href="#i-warn"/></svg>
        <strong data-field="title" class="font-bold text-base"></strong>
      </div>
      <div class="flex items-center gap-2 ms-auto">
        <button type="button" class="btn btn-sm btn-primary" data-action="untrust" data-testid="tls-untrust-{host}"><span data-i18n="portal.tls.doNotTrust"></span></button>
        <button type="button" class="btn btn-sm btn-outline btn-error whitespace-nowrap gap-1 btn-disabled pointer-events-none" disabled data-action="accept" data-testid="tls-accept-{host}"><svg class="size-4" aria-hidden="true"><use href="#i-touch"/></svg><span data-i18n="portal.tls.trust"></span></button>
      </div>
    </div>
    <div class="text-xs opacity-80" data-field="text"></div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 w-full text-xs" data-testid="tls-diff-grid">
      <div class="rounded-lg bg-base-100/60 p-3 border border-base-content/10 space-y-1.5" data-testid="tls-col-before">
        <p class="text-sm font-medium muted" data-i18n="portal.tls.colBefore"></p>
        <dl class="space-y-1">
          <div><dt class="opacity-60 inline" data-i18n="portal.tls.issuer"></dt>: <dd class="inline font-medium" data-field="before-issuer"></dd></div>
          <div><dt class="opacity-60 inline" data-i18n="portal.tls.root"></dt>: <dd class="inline font-mono text-[11px]" data-field="before-root"></dd></div>
          <div><dt class="opacity-60 inline" data-i18n="portal.tls.validTo"></dt>: <dd class="inline" data-field="before-valid"></dd></div>
          <div><dt class="opacity-60 inline" data-i18n="portal.tls.fingerprint"></dt>: <dd class="inline font-mono text-[11px]" data-field="before-fp"></dd></div>
        </dl>
      </div>
      <div class="rounded-lg bg-base-100/60 p-3 border border-base-content/10 space-y-1.5" data-testid="tls-col-now">
        <p class="text-sm font-medium muted" data-i18n="portal.tls.colNow"></p>
        <dl class="space-y-1">
          <div><dt class="opacity-60 inline" data-i18n="portal.tls.issuer"></dt>: <dd class="inline font-medium" data-field="now-issuer"></dd></div>
          <div><dt class="opacity-60 inline" data-i18n="portal.tls.root"></dt>: <dd class="inline font-mono text-[11px]" data-field="now-root"></dd></div>
          <div><dt class="opacity-60 inline" data-i18n="portal.tls.validTo"></dt>: <dd class="inline" data-field="now-valid"></dd></div>
          <div><dt class="opacity-60 inline" data-i18n="portal.tls.fingerprint"></dt>: <dd class="inline font-mono text-[11px]" data-field="now-fp"></dd></div>
        </dl>
      </div>
    </div>
  </div>
</template>
`;var Yt="vaultgate.tls-dismissed.";function je(e){return!e||typeof e!="string"?"-":e.length>24?e.slice(0,23)+"…":e}m("ks-tls",{template:Jt,async load(){let t=(await c("GET","/api/tls")).filter(s=>{try{let o=s.observedFingerprint||s.fingerprint||s.observedRoot||"dismissed";return localStorage.getItem(Yt+s.origin)!==o}catch{return!0}});this.classList.toggle("hidden",t.length===0),this.querySelectorAll("[role=alert]").forEach(s=>s.remove());for(let s of t){let o=new URL(s.origin).host,n=s.kind==="tls-untrusted",r=s.pinnedIssuer||i("portal.tls.noEarlier"),d=s.observedIssuer||"-",p=je(s.pinnedRoot),l=je(s.observedRoot),k=s.pinnedValidTo||"-",y=s.observedValidTo||s.validTo||"-",b=je(s.pinnedFingerprint),u=je(s.observedFingerprint||s.fingerprint),E=!1,I,le={untrust:()=>{try{let za=s.observedFingerprint||s.fingerprint||s.observedRoot||"dismissed";localStorage.setItem(Yt+s.origin,za)}catch{}I?.remove(),this.querySelectorAll("[role=alert]").length===0&&this.classList.add("hidden")},accept:async()=>{E&&(await c("POST","/api/tls/accept",{origin:s.origin}),await this.load())}};I=g(this,"change",{host:o,title:i(n?"portal.tls.titleUntrusted":"portal.tls.titleChanged",{origin:s.origin}),text:n?i("portal.tls.textUntrusted",{now:d,root:s.observedRoot,validTo:s.validTo??"-"}):i("portal.tls.text",{before:r,now:d}),"before-issuer":r,"now-issuer":d,"before-root":p,"now-root":l,"before-valid":k,"now-valid":y,"before-fp":b,"now-fp":u},le);let Z=I.querySelector('[data-testid="tls-col-now"]');Z&&(r!==d&&Z.querySelector('[data-field="now-issuer"]')?.classList.add("text-warning","font-semibold"),p!==l&&Z.querySelector('[data-field="now-root"]')?.classList.add("text-warning","font-semibold"),k!==y&&Z.querySelector('[data-field="now-valid"]')?.classList.add("text-warning","font-semibold"),b!==u&&Z.querySelector('[data-field="now-fp"]')?.classList.add("text-warning","font-semibold"));let Ce=I.querySelector('[data-action="accept"]');setTimeout(()=>{E=!0,Ce&&(Ce.disabled=!1,Ce.classList.remove("btn-disabled","pointer-events-none"))},1500),this.appendChild(I)}}});var Zt=`<div class="work-head flex-wrap">
  <div class="min-w-0">
    <h1 class="screen-title" data-i18n="portal.tls.title"></h1>
    <p class="max-w-[68ch]" data-i18n="portal.tls.subtitle"></p>
  </div>
  <div class="flex items-center gap-2 shrink-0">
    <button type="button" class="btn btn-ghost btn-sm gap-1.5" data-action="open-intro"><svg class="size-4" aria-hidden="true"><use href="#i-shield"/></svg><span data-i18n="portal.tls.guideBtn"></span></button>
    <button type="button" class="btn btn-outline btn-sm gap-1.5" data-action="open-review"><svg class="size-4" aria-hidden="true"><use href="#i-cert"/></svg><span data-i18n="portal.tls.reviewBtn"></span></button>
  </div>
</div>
<div class="split h-[calc(100vh-15rem)] min-h-[420px]">
  <section class="panel" aria-labelledby="tls-roots-head">
    <div class="panel-head"><h2 id="tls-roots-head" data-i18n="portal.tls.roots"></h2><span id="tls-waits"></span></div>
    <div id="tls-list" class="panel-body rows" role="listbox" data-testid="tls-list" data-i18n-aria-label="portal.tls.roots"></div>
    <p id="tls-trusted-empty" class="panel-foot muted hidden" data-i18n="portal.tls.emptyTrusted"></p>
  </section>
  <section id="tls-detail" class="panel" data-testid="tls-detail" data-i18n-aria-label="portal.tls.title"></section>
</div>

<!-- Een keten die je niet vertrouwt (gewijzigd of nooit vertrouwd): wacht op jou. -->
<template data-template="broken-row">
  <button type="button" role="option" class="row" data-testid="tls-broken-row">
    <span class="row-icon text-[var(--bad)]"><svg aria-hidden="true"><use href="#i-chain-broken"/></svg></span>
    <span class="min-w-0"><span class="row-title" data-field="root"></span><span class="row-sub" data-field="host"></span></span>
    <span class="stamp stamp-alarm" data-field="kind" translate="no"></span>
  </button>
</template>
<template data-template="broken-detail">
  <article class="detail">
    <div>
      <p class="reading reading-bad" data-field="kind" translate="no"></p>
      <p class="reading-note" data-field="description"></p>
    </div>
    <dl class="facts">
      <dt data-i18n="portal.tls.colBefore"></dt><dd data-field="before"></dd>
      <dt data-i18n="portal.tls.colNow"></dt><dd data-field="now"></dd>
      <dt data-i18n="portal.tls.fingerprint"></dt><dd class="mono" data-field="fingerprint"></dd>
      <dt data-i18n="portal.tls.validTo"></dt><dd data-field="validTo"></dd>
      <dt data-i18n="portal.tls.requests"></dt><dd data-i18n="portal.tls.stopped"></dd>
    </dl>
    <div class="detail-actions">
      <p data-i18n="portal.tls.notYours"></p>
      <button type="button" class="btn btn-outline btn-sm" data-action="review-trust" data-testid="tls-review-trust" data-i18n="portal.tls.reviewTrust"></button>
    </div>
  </article>
</template>

<!-- Een root die je vertrouwt, voor één domein of voor alle (een bedrijfsproxy: elke request is dan "inspected"). -->
<template data-template="trusted-row">
  <button type="button" role="option" class="row" data-testid="tls-trusted-row">
    <span class="row-icon"><svg aria-hidden="true"><use href="#i-cert"/></svg></span>
    <span class="min-w-0"><span class="row-title" data-field="issuer"></span><span class="row-sub" data-field="scope"></span></span>
    <span data-if="globalScope" class="tag tag-warn" data-i18n="portal.tls.inspected"></span><span data-if="hostScope" class="tag" data-i18n="portal.tls.trusted"></span>
  </button>
</template>
<template data-template="trusted-detail">
  <article class="detail">
    <div>
      <p class="reading" data-field="reading"></p>
      <p data-if="globalScope" class="reading-note" data-i18n="portal.tls.globalNote"></p>
      <p data-if="hostScope" class="reading-note" data-field="hostNote"></p>
    </div>
    <dl class="facts">
      <dt data-i18n="portal.tls.fingerprint"></dt><dd class="mono" data-field="fingerprint"></dd>
      <dt data-if="validTo" data-i18n="portal.tls.validTo"></dt><dd data-if="validTo" data-field="validTo"></dd>
      <dt data-if="trustedAt" data-i18n="portal.tls.trustedAt"></dt><dd data-if="trustedAt" data-field="trustedAt"></dd>
      <dt data-i18n="portal.tls.chain"></dt><dd class="flex items-center gap-1.5"><svg class="size-4 text-[var(--ok)]" aria-hidden="true"><use href="#i-chain-ok"/></svg><span data-i18n="portal.tls.chainIntact"></span></dd>
    </dl>
    <div class="detail-actions">
      <button type="button" class="btn btn-sm btn-ghost text-[var(--bad)] gap-1" data-action="revoke-trust"><svg class="size-4" aria-hidden="true"><use href="#i-ban"/></svg><span data-i18n="portal.tls.revoke"></span></button>
      <button type="button" class="btn btn-sm btn-outline gap-1" data-action="details"><svg class="size-4" aria-hidden="true"><use href="#i-cert"/></svg><span data-i18n="portal.tls.details"></span></button>
    </div>
  </article>
</template>
<template data-template="pick"><p class="p-6 muted" data-i18n="portal.tls.emptyTrusted"></p></template>
`;var Qt=`<!-- De dialogen van Certificates (hoort bij ks-tls-tab): uitleg, vertrouwen, intrekken, details, roots op deze pc. -->
<!-- Intro modal (#tls-intro-dialog) -->
<dialog id="tls-intro-dialog" class="modal" data-testid="tls-intro-dialog" aria-labelledby="tls-intro-title">
  <div class="modal-box max-w-xl border border-base-content/10">
    <h3 id="tls-intro-title" class="font-bold text-xl flex items-center gap-2 pr-8"><svg class="size-6 text-warning" aria-hidden="true"><use href="#i-shield"/></svg><span data-i18n="portal.tls.introTitle"></span></h3>
    <p class="text-sm opacity-80 mt-2" data-i18n="portal.tls.introDesc"></p>
    <div class="space-y-3 mt-4 text-sm">
      <div class="flex items-start gap-3 rounded-lg bg-base-200 p-3">
        <div class="badge badge-info badge-sm shrink-0 mt-0.5 font-bold">1</div>
        <div>
          <p class="font-semibold" data-i18n="portal.tls.step1Title"></p>
          <p class="opacity-75 text-xs mt-0.5" data-i18n="portal.tls.step1Desc"></p>
        </div>
      </div>
      <div class="flex items-start gap-3 rounded-lg bg-base-200 p-3">
        <div class="badge badge-success badge-sm shrink-0 mt-0.5 font-bold">2</div>
        <div>
          <p class="font-semibold" data-i18n="portal.tls.step2Title"></p>
          <p class="opacity-75 text-xs mt-0.5" data-i18n="portal.tls.step2Desc"></p>
        </div>
      </div>
      <div class="alert alert-warning alert-soft text-xs">
        <svg class="size-5 shrink-0" aria-hidden="true"><use href="#i-warn"/></svg>
        <div>
          <strong class="font-semibold block" data-i18n="portal.tls.inspectionWarnTitle"></strong>
          <span data-i18n="portal.tls.inspectionWarn"></span>
        </div>
      </div>
    </div>
    <form method="dialog" class="modal-action">
      <button class="btn btn-primary" data-action="close-intro" data-i18n="portal.tls.understand"></button>
    </form>
    <form method="dialog"><button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" data-i18n-aria-label="portal.keys.close"><svg class="size-4" aria-hidden="true"><use href="#i-x"/></svg></button></form>
  </div>
  <form method="dialog" class="modal-backdrop"><button tabindex="-1" data-i18n="portal.keys.close"></button></form>
</dialog>

<!-- Trust modal (#tls-trust-dialog) -->
<dialog id="tls-trust-dialog" class="modal" data-testid="tls-trust-dialog" aria-labelledby="tls-trust-title">
  <div class="modal-box max-w-lg border border-base-content/10">
    <h3 id="tls-trust-title" class="font-bold text-xl flex items-center gap-2 pr-8"><svg class="size-5 text-warning" aria-hidden="true"><use href="#i-cert"/></svg><span id="tls-trust-heading"></span></h3>
    <div class="alert alert-warning alert-soft text-xs mt-3">
      <svg class="size-4 shrink-0" aria-hidden="true"><use href="#i-warn"/></svg>
      <div>
        <strong class="font-semibold block" data-i18n="portal.tls.inspectionWarnTitle"></strong>
        <span id="tls-trust-warn-text"></span>
      </div>
    </div>
    <p class="text-sm opacity-80 mt-3" data-i18n="portal.tls.trustInstruction"></p>
    <div class="rounded-box bg-base-200 p-3 mt-3 text-sm">
      <p id="tls-trust-issuer" class="font-semibold"></p>
      <p id="tls-trust-fingerprint" class="font-mono text-xs mt-1 break-all"></p>
    </div>
    <div class="space-y-2 mt-4 text-sm">
      <p class="text-sm font-medium" data-i18n="portal.tls.trustScope"></p>
      <label class="flex items-start gap-2.5 p-2 rounded-lg bg-base-100 border border-base-content/10 cursor-pointer">
        <input type="radio" name="trust-scope" value="host" class="radio radio-sm mt-0.5" checked>
        <div>
          <p id="tls-trust-scope-host-label" class="font-semibold text-xs"></p>
          <p class="text-xs opacity-70" data-i18n="portal.tls.scopeHostDesc"></p>
        </div>
      </label>
      <label class="flex items-start gap-2.5 p-2 rounded-lg bg-base-100 border border-base-content/10 cursor-pointer">
        <input type="radio" name="trust-scope" value="global" class="radio radio-sm mt-0.5">
        <div>
          <p class="font-semibold text-xs" data-i18n="portal.tls.scopeGlobalTitle"></p>
          <p class="text-xs opacity-70" data-i18n="portal.tls.scopeGlobalDesc"></p>
        </div>
      </label>
    </div>
    <div class="modal-action">
      <form method="dialog"><button class="btn btn-ghost" data-action="close-trust" data-i18n="portal.tls.keepBlocking"></button></form>
      <button type="button" class="btn btn-warning gap-1" data-action="trust-touch"><svg class="size-4" aria-hidden="true"><use href="#i-touch"/></svg><span data-i18n="portal.tls.trustTouch"></span></button>
    </div>
    <form method="dialog"><button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" data-i18n-aria-label="portal.keys.close"><svg class="size-4" aria-hidden="true"><use href="#i-x"/></svg></button></form>
  </div>
  <form method="dialog" class="modal-backdrop"><button tabindex="-1" data-i18n="portal.keys.close"></button></form>
</dialog>

<!-- Untrust modal (#tls-untrust-dialog) -->
<dialog id="tls-untrust-dialog" class="modal" data-testid="tls-untrust-dialog" aria-labelledby="tls-untrust-title">
  <div class="modal-box max-w-lg border border-base-content/10">
    <h3 id="tls-untrust-title" class="font-bold text-xl flex items-center gap-2 pr-8"><svg class="size-5 text-error" aria-hidden="true"><use href="#i-ban"/></svg><span id="tls-untrust-heading"></span></h3>
    <p id="tls-untrust-desc" class="mt-2 text-sm"></p>
    <p class="text-xs opacity-70 mt-2" data-i18n="portal.tls.untrustImmediate"></p>
    <div class="modal-action">
      <form method="dialog"><button class="btn btn-ghost" data-action="cancel-untrust" data-i18n="portal.common.cancel"></button></form>
      <button type="button" class="btn btn-error" data-action="confirm-untrust" data-i18n="portal.tls.untrustConfirm"></button>
    </div>
    <form method="dialog"><button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" data-i18n-aria-label="portal.keys.close"><svg class="size-4" aria-hidden="true"><use href="#i-x"/></svg></button></form>
  </div>
  <form method="dialog" class="modal-backdrop"><button tabindex="-1" data-i18n="portal.keys.close"></button></form>
</dialog>

<!-- Details modal (#tls-details-dialog) -->
<dialog id="tls-details-dialog" class="modal" data-testid="tls-details-dialog" aria-labelledby="tls-details-title">
  <div class="modal-box max-w-2xl border border-base-content/10">
    <h3 id="tls-details-title" class="font-bold text-xl flex items-center gap-2 pr-8"><svg class="size-5 text-success" aria-hidden="true"><use href="#i-cert"/></svg><span id="tls-details-heading"></span></h3>
    <dl class="grid grid-cols-[9rem_1fr] gap-y-1.5 text-sm mt-3">
      <dt class="opacity-70" data-i18n="portal.tls.detailsIssuer"></dt><dd id="tls-details-issuer"></dd>
      <dt class="opacity-70" data-i18n="portal.tls.detailsFingerprint"></dt><dd id="tls-details-fingerprint" class="font-mono text-xs break-all"></dd>
      <dt class="opacity-70" data-i18n="portal.tls.detailsValid"></dt><dd id="tls-details-valid"></dd>
      <dt class="opacity-70" data-i18n="portal.tls.detailsScope"></dt><dd id="tls-details-scope"></dd>
    </dl>
    <div class="modal-action">
      <form method="dialog"><button class="btn btn-ghost" data-action="close-details" data-i18n="portal.common.close"></button></form>
    </div>
    <form method="dialog"><button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" data-i18n-aria-label="portal.keys.close"><svg class="size-4" aria-hidden="true"><use href="#i-x"/></svg></button></form>
  </div>
  <form method="dialog" class="modal-backdrop"><button tabindex="-1" data-i18n="portal.keys.close"></button></form>
</dialog>

<!-- Review roots modal (#tls-review-dialog) -->
<dialog id="tls-review-dialog" class="modal" data-testid="tls-review-dialog" aria-labelledby="tls-review-title">
  <div class="modal-box max-w-2xl border border-base-content/10">
    <h3 id="tls-review-title" class="font-bold text-xl flex items-center gap-2 pr-8"><svg class="size-5 text-primary" aria-hidden="true"><use href="#i-cert"/></svg><span data-i18n="portal.tls.reviewRootsTitle"></span></h3>
    <p class="text-sm opacity-75 mt-1" data-i18n="portal.tls.reviewRootsDesc"></p>
    <div id="tls-review-list" class="ledger mt-3"></div>
    <p id="tls-review-empty" class="text-sm opacity-70 mt-3 hidden" data-i18n="portal.tls.noExtraRoots"></p>
    <div class="modal-action">
      <form method="dialog"><button class="btn btn-primary" data-action="close-review" data-i18n="portal.common.done"></button></form>
    </div>
    <form method="dialog"><button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" data-i18n-aria-label="portal.keys.close"><svg class="size-4" aria-hidden="true"><use href="#i-x"/></svg></button></form>
  </div>
  <form method="dialog" class="modal-backdrop"><button tabindex="-1" data-i18n="portal.keys.close"></button></form>
</dialog>

<template data-template="review-row">
  <div class="ledger-row">
    <div class="min-w-0 flex-1">
      <p class="font-semibold" data-field="subject"></p>
      <p class="text-xs opacity-75 font-mono" data-field="fingerprint"></p>
    </div>
  </div>
</template>
`;var zs=Zt+Qt,Xt="vaultgate.tls-intro-seen";function $e(e){return!e||typeof e!="string"?"-":e.length>24?e.slice(0,23)+"…":e}function Es(e,t){e.currentPending=t;let s=t.observedIssuer||t.observedRoot||"-",o=e.querySelector("#tls-trust-dialog");e.querySelector("#tls-trust-heading").textContent=i("portal.tls.trustTitle",{root:s}),e.querySelector("#tls-trust-warn-text").textContent=i("portal.tls.trustWarn",{root:s}),e.querySelector("#tls-trust-issuer").textContent=s,e.querySelector("#tls-trust-fingerprint").textContent=t.fingerprint||t.observedRoot||"-",e.querySelector("#tls-trust-scope-host-label").textContent=i("portal.tls.scopeHostTitle",{origin:t.origin}),o.showModal()}function As(e,t){e.currentRevoke=t;let s=t.issuer||t.origin||"-",o=e.querySelector("#tls-untrust-dialog");e.querySelector("#tls-untrust-heading").textContent=i("portal.tls.untrustTitle",{root:s}),e.querySelector("#tls-untrust-desc").textContent=i("portal.tls.untrustDesc",{root:s}),o.showModal()}function Ls(e,t){let s=e.querySelector("#tls-details-dialog");e.querySelector("#tls-details-heading").textContent=t.issuer||"-",e.querySelector("#tls-details-issuer").textContent=t.issuer||"-",e.querySelector("#tls-details-fingerprint").textContent=t.fingerprint||t.root||"-",e.querySelector("#tls-details-valid").textContent=t.validTo?`${t.validFrom||""} - ${t.validTo}`:"-",e.querySelector("#tls-details-scope").textContent=t.scope==="global"||t.origin==="*"?i("portal.tls.scopeGlobal"):t.origin,s.showModal()}async function Ps(e){let t=e.querySelector("#tls-review-list"),s=e.querySelector("#tls-review-empty");t.replaceChildren();let o=[];try{o=await c("GET","/api/tls/added-roots")}catch{}if(!o||o.length===0){s.classList.remove("hidden");return}s.classList.add("hidden");for(let n of o){let r=g(e,"review-row",{subject:n.subject||n.issuer||"-",fingerprint:$e(n.fingerprint256||n.fingerprint)});t.appendChild(r)}}m("ks-tls-tab",{template:zs,wire(){this.currentPending=null,this.currentRevoke=null;let e=this.querySelector("#tls-intro-dialog"),t=this.querySelector("#tls-trust-dialog"),s=this.querySelector("#tls-untrust-dialog"),o=this.querySelector("#tls-review-dialog");this.querySelector('[data-action="open-intro"]')?.addEventListener("click",()=>e.showModal()),e?.addEventListener("close",()=>{try{localStorage.setItem(Xt,"1")}catch{}}),this.querySelector('[data-action="open-review"]')?.addEventListener("click",()=>v(async()=>{await Ps(this),o.showModal()})),this.querySelector('[data-action="trust-touch"]')?.addEventListener("click",()=>v(async()=>{if(!this.currentPending)return;let n=this.querySelector('input[name="trust-scope"]:checked')?.value??"host";await c("POST","/api/tls/accept",{origin:this.currentPending.origin,scope:n}),t.close(),this.currentPending=null,await this.load()})),this.querySelector('[data-action="confirm-untrust"]')?.addEventListener("click",()=>v(async()=>{this.currentRevoke&&(await c("POST","/api/tls/revoke",{origin:this.currentRevoke.origin,root:this.currentRevoke.root}),s.close(),this.currentRevoke=null,await this.load())}))},async load(){let e=!1;try{e=!!localStorage.getItem(Xt)}catch{}let t=this.querySelector("#tls-intro-dialog");if(!e&&t&&typeof t.showModal=="function")try{t.showModal()}catch{}let[s,o]=await Promise.all([c("GET","/api/tls"),c("GET","/api/tls/trusted")]),n=l=>{let k=l.observedIssuer||l.observedRoot||"-";return g(this,"broken-detail",{kind:l.kind,before:l.pinnedIssuer||l.pinnedRoot||i("portal.tls.noEarlier"),now:k,description:i(l.kind==="tls-chain-changed"?"portal.tls.changedNote":"portal.tls.untrustedNote",{host:w(l.origin),root:k}),fingerprint:$e(l.fingerprint),validTo:l.validTo??"-"},{"review-trust":()=>Es(this,l)})},r=l=>l.scope==="global"||l.origin==="*",d=l=>g(this,"trusted-detail",{reading:i(r(l)?"portal.tls.trustedAll":"portal.tls.trustedOne"),globalScope:r(l),hostScope:!r(l),hostNote:i("portal.tls.hostNote",{origin:w(l.origin)}),fingerprint:$e(l.fingerprint||l.root),validTo:l.validTo??"",trustedAt:l.updatedAt?C(l.updatedAt):""},{details:()=>Ls(this,l),"revoke-trust":()=>As(this,l)}),p=[...s.map(l=>({row:g(this,"broken-row",{kind:l.kind,root:l.observedIssuer||l.observedRoot||"-",host:w(l.origin)}),item:{key:"p"+l.origin,render:()=>n(l)}})),...(o??[]).map(l=>({row:g(this,"trusted-row",{issuer:l.issuer||"-",scope:r(l)?i("portal.tls.allDomains"):w(l.origin),globalScope:r(l),hostScope:!r(l)}),item:{key:"t"+l.origin+l.root,render:()=>d(l)}}))];this.querySelector("#tls-waits").textContent=s.length?i("portal.tls.waits",{count:s.length}):"",this.querySelector("#tls-trusted-empty").classList.toggle("hidden",(o??[]).length>0),A(this.querySelector("#tls-list"),this.querySelector("#tls-detail"),p,{keyOf:l=>l.key,render:l=>l.render(),empty:()=>g(this,"pick")})}});var Ns=(e,t)=>e.mode!=="admin"&&t.mode!=="admin"&&e.tool===t.tool&&e.secret===t.secret&&e.host===t.host&&e.rule===t.rule&&e.allow===t.allow;function ea(e){let t=[];for(let s of e){let o=t.at(-1),n=s.count??1;o&&Ns(o.entry,s)?(o.count+=n,o.since=s.t):t.push({entry:s,count:n,since:s.t})}return t}var ta=`<section id="waiting-list" class="panel grid grid-cols-1 divide-y divide-[var(--line)] md:grid-flow-col md:auto-cols-fr md:divide-x md:divide-y-0" data-i18n-aria-label="portal.waiting.title"></section>
<p id="waiting-none" class="note hidden" data-testid="waiting-none"><svg class="text-[var(--ok)]" aria-hidden="true"><use href="#i-check"/></svg><span data-i18n="portal.waiting.none"></span></p>

<template data-template="item">
  <div class="flex items-center gap-3 px-4 py-3" data-testid="waiting-{kind}">
    <svg class="size-4 shrink-0 text-[var(--muted)]" aria-hidden="true"><use data-icon/></svg>
    <span class="min-w-0 flex-1 text-sm" data-field="text"></span>
    <button data-if="button" class="btn btn-sm btn-outline" data-action="go" data-testid="waiting-{kind}-go" data-field="button"></button>
  </div>
</template>
`;var Je=e=>async()=>{S(e),await a("view-main").load()};m("ks-waiting",{template:ta,async load(){let[e,t,s]=await Promise.all([c("GET","/api/device"),c("GET","/api/tls"),c("GET","/api/approvals")]),o=T(),n=(d,p,l,k,y)=>{let b=g(this,"item",{kind:d,text:l,button:k&&i(k)},{go:y});return b.querySelector("[data-icon]").setAttribute("href","#"+p),b},r=[...e.map(d=>n("pair","i-link",i("portal.waiting.pair",{name:d.clientName}),"portal.waiting.review",Je("tools"))),...t.map(d=>n("tls","i-cert",i("portal.waiting.tls",{host:new URL(d.origin).host}),"portal.waiting.decide",Je("tls"))),...o.needsMorePasskeys?[n("passkeys","i-key",i(o.credentialCount===0?"portal.main.noPasskey":"portal.main.onePasskey"),"portal.waiting.check",Je("passkeys"))]:[],...s.map(d=>n("approval","i-bell",i("portal.waiting.approval",{tool:d.tool,secret:d.secret,host:d.host})))];return a("waiting-list").replaceChildren(...r),a("waiting-list").classList.toggle("hidden",r.length===0),a("waiting-none").classList.toggle("hidden",r.length>0),r.length}});var aa=`<div class="work-head flex-wrap">
  <div>
    <h1 class="screen-title" data-i18n="portal.audit.title"></h1>
    <p id="audit-intro" class="max-w-[68ch]" data-testid="audit-intro"></p>
  </div>
  <div class="figures" data-testid="stats">
    <span class="figure"><b id="stat-allowed" data-testid="stat-allowed">0</b><span data-i18n="portal.audit.statAllowed"></span></span>
    <span class="figure"><b id="stat-stopped" data-testid="stat-stopped">0</b><span data-i18n="portal.audit.statStopped"></span></span>
    <span class="figure"><b id="stat-scrubbed" data-testid="stat-scrubbed">0</b><span data-i18n="portal.audit.statScrubbed"></span></span>
  </div>
</div>
<ks-waiting id="waiting" class="block" data-testid="waiting"></ks-waiting>
<div class="split h-[calc(100vh-17rem)] min-h-[440px]">
  <section class="panel" aria-labelledby="audit-head">
    <div class="panel-head">
      <h2 id="audit-head" data-i18n="portal.audit.latest"></h2>
      <div class="flex items-center gap-2">
        <select id="a-decision" class="select select-sm w-40" data-testid="a-decision" data-i18n-aria-label="portal.audit.decision">
          <option value="" data-i18n="portal.audit.all"></option><option value="allow" data-i18n="portal.audit.allowed"></option><option value="deny" data-i18n="portal.audit.stopped"></option><option value="admin" data-i18n="portal.audit.admin"></option>
        </select>
        <details id="a-more" class="dropdown dropdown-end">
          <summary class="btn btn-sm btn-ghost" data-testid="a-more" data-i18n="portal.audit.filter"></summary>
          <div class="dropdown-content z-10 mt-1 w-64 rounded-box border border-[var(--line-2)] bg-base-100 p-3 space-y-2">
            <input id="a-tool" class="input input-sm w-full" data-testid="a-tool" data-i18n-placeholder="portal.common.tool" data-i18n-aria-label="portal.common.tool">
            <input id="a-secret" class="input input-sm w-full" data-testid="a-secret" data-i18n-placeholder="portal.common.secret" data-i18n-aria-label="portal.common.secret">
            <input id="a-host" class="input input-sm w-full" data-testid="a-host" data-i18n-placeholder="portal.common.host" data-i18n-aria-label="portal.common.host">
            <button id="a-go" class="btn btn-sm btn-primary w-full" data-testid="a-go" data-i18n="portal.audit.filter"></button>
          </div>
        </details>
      </div>
    </div>
    <ul id="audit" class="panel-body rows" role="listbox" data-testid="audit-table" data-i18n-aria-label="portal.audit.latest"></ul>
    <p id="audit-empty" class="muted hidden p-4" data-testid="audit-empty" data-i18n="portal.audit.empty"></p>
  </section>
  <section id="audit-detail" class="panel" data-testid="audit-detail" data-i18n-aria-label="portal.audit.decision"></section>
</div>

<template data-template="entry">
  <li role="none"><button type="button" role="option" class="row" data-testid="audit-row" aria-selected="false">
    <span class="row-time" data-field="time"></span>
    <span class="min-w-0"><span class="row-title"><span data-field="who"></span> <span data-if="grouped" class="muted font-normal mono" data-testid="audit-count" data-field="count"></span></span><span class="row-sub" data-field="where"></span></span>
    <span data-field="stamp"></span>
  </button></li>
</template>
<template data-template="detail">
  <article class="detail">
    <div>
      <p class="reading" data-field="rule" translate="no"></p>
      <p class="reading-note" data-field="sentence"></p>
    </div>
    <span data-if="hasChain" class="chain">
      <span class="chain-link"><svg aria-hidden="true"><use href="#i-bot"/></svg><span data-field="tool"></span></span>
      <span data-if="secret" class="chain-sep">→</span><span data-if="secret" class="chain-link"><svg aria-hidden="true"><use href="#i-key"/></svg><span data-field="secret"></span></span>
      <span data-if="host" class="chain-sep">→</span><span data-if="host" class="chain-link" data-chain="host"><svg aria-hidden="true"><use href="#i-globe"/></svg><span data-field="host"></span></span>
    </span>
    <dl class="facts">
      <dt data-i18n="portal.audit.fact.when"></dt><dd class="mono" data-field="when"></dd>
      <dt data-if="grouped" data-i18n="portal.audit.fact.repeat"></dt><dd data-if="grouped" data-field="repeat"></dd>
      <dt data-if="hasRequest" data-i18n="portal.audit.fact.request"></dt><dd data-if="hasRequest" class="mono" data-field="request"></dd>
      <dt data-if="client" data-i18n="portal.audit.fact.from"></dt><dd data-if="client" class="mono" data-field="client"></dd>
      <dt data-if="admin" data-i18n="portal.audit.fact.change"></dt><dd data-if="admin" data-testid="audit-change" data-field="change"></dd>
      <dt data-if="inspected" data-i18n="portal.audit.fact.connection"></dt><dd data-if="inspected"><span class="tag tag-warn" data-field="inspectedText"></span></dd>
    </dl>
    <div class="detail-actions">
      <span></span>
      <div class="flex gap-2">
        <button data-if="renew" class="btn btn-sm btn-primary" data-action="renew" data-testid="audit-renew" data-i18n="portal.audit.renew"></button>
        <button data-if="createSecret" class="btn btn-sm btn-primary" data-action="createSecret" data-testid="audit-create-secret" data-i18n="portal.audit.createSecret"></button>
        <button data-if="allowHost" class="btn btn-sm btn-outline" data-action="allowHost" data-testid="audit-allow-host" data-i18n="portal.audit.allowHost"></button>
        <button data-if="place" class="btn btn-sm btn-outline gap-1" data-action="place" data-testid="audit-allow-place"><svg class="size-4" aria-hidden="true"><use href="#i-touch"/></svg><span data-i18n="portal.audit.allowPlace"></span></button>
      </div>
    </div>
  </article>
</template>
<template data-template="pick"><p class="muted p-6" data-i18n="portal.audit.pick"></p></template>
<template data-template="stamp-pass"><span class="stamp stamp-pass rule"><svg class="size-3" aria-hidden="true"><use href="#i-check"/></svg><span data-field="rule" translate="no"></span></span></template>
<template data-template="stamp-shield"><span class="stamp stamp-shield rule"><svg class="size-3" aria-hidden="true"><use href="#i-shield"/></svg><span data-field="rule" translate="no"></span></span></template>
<template data-template="stamp-warn"><span class="stamp stamp-warn rule"><svg class="size-3" aria-hidden="true"><use href="#i-warn"/></svg><span data-field="rule" translate="no"></span></span></template>
<template data-template="stamp-admin"><span class="stamp stamp-admin rule"><svg class="size-3" aria-hidden="true"><use href="#i-gear"/></svg><span data-field="rule" translate="no"></span></span></template>
<template data-template="stamp-alarm"><span class="stamp stamp-alarm rule"><span data-field="rule" translate="no"></span></span></template>
`;var Vs=new Set(["tls-chain-changed","tls-untrusted","audit-unavailable","key-reuse-detected","internal-error"]),qs=new Set(["target-host-not-allowed","throttled","quiet-hours"]),Os=new Set(["grant-expired","approval-denied","approval-timeout","approval-unavailable"]),sa={pass:"reading-ok",shield:"reading-cool",warn:"reading-warn",alarm:"reading-bad"},Rs=e=>[e.t,e.rule,e.tool,e.host,e.mode].join("|"),Hs=e=>new Date(e).toLocaleString([],{dateStyle:"medium",timeStyle:"medium"}),Ye=e=>e.mode==="admin"?"admin":Vs.has(e.rule)?"alarm":qs.has(e.rule)?"warn":e.allow?"pass":"shield",na=e=>q("portal.audit.via."+e.origin)?i("portal.audit.via."+e.origin):e.origin,Ms=e=>[na(e),e.detail].filter(Boolean).join(" · ");function Gs(e){let t={tool:e.tool||"?",secret:e.secret||"?",host:e.host||"?"},s="rules."+e.rule,o=e.mode==="admin"?"rules.fallback.admin":e.allow?"rules.fallback.allow":"rules.fallback.deny";return i(q(s)?s:o,t)}async function Us(e,t){let s=(await c("GET","/api/secrets")).find(o=>o.name===t.secret);!s||!await x(i("portal.audit.allowPlaceConfirm",{secret:t.secret,place:t.detail}),{ok:"portal.audit.allowPlace"})||(await c("PUT","/api/secrets/"+s.id+"/inject",{inject:[...new Set([...s.inject??[],...t.detail.split(",")])]}),await e.load())}async function oa(e,{newHost:t=!1}={}){S("grants"),await a("view-main").load(),a("tab-grants").openAdd({toolName:e.tool,secretName:e.secret,host:e.host,newHost:t})}async function Ks(e){S("secrets"),await a("view-main").load(),a("tab-secrets").openAdd?.({name:e.secret,host:e.host})}function Ws(e,{entry:t,count:s,since:o}){let n=Ye(t),r=g(e,"detail",{rule:t.rule,sentence:Gs(t),tool:t.tool||i("portal.audit.noTool"),secret:t.secret??"",host:t.host??"",hasChain:t.mode!=="admin"&&!!(t.tool||t.secret||t.host),when:Hs(t.t),grouped:s>1,repeat:i("portal.audit.repeat",{count:s,since:N(o)}),request:t.method&&t.method!=="CONNECT"?t.method:"",hasRequest:!!(t.method&&t.method!=="CONNECT"),client:t.client??"",inspected:!!t.inspected,inspectedText:!t.inspected||t.inspected===!0||t.inspected==="inspected"?"inspected":`inspected: ${t.inspected}`,admin:t.mode==="admin",change:Ms(t),renew:Os.has(t.rule)&&t.tool&&t.secret&&t.host,createSecret:t.rule==="unknown-secret"&&!!t.secret,place:t.rule==="placeholder-location-not-allowed"&&/^(header|query):/.test(t.detail??""),allowHost:t.rule==="target-host-not-allowed"&&t.tool&&t.secret&&t.host},{createSecret:()=>Ks(t),place:()=>Us(e,t),renew:()=>oa(t),allowHost:()=>oa(t,{newHost:!0})});return r.querySelector("[data-action]")||r.querySelector(".detail-actions")?.remove(),sa[n]&&r.querySelector(".reading").classList.add(sa[n]),t.rule==="target-host-not-allowed"&&r.querySelector('[data-chain="host"]')?.classList.add("is-bad"),r}m("ks-audit",{template:aa,wire(){h("a-go",()=>(a("a-more").open=!1,this.load())),a("a-decision").addEventListener("change",()=>v(()=>this.load()))},async load(){let e=new Date;e.setHours(0,0,0,0);let t=new URLSearchParams({tool:a("a-tool").value,secret:a("a-secret").value,host:a("a-host").value,decision:a("a-decision").value}),[s,o,n]=await Promise.all([c("GET","/api/stats?since="+e.getTime()),c("GET","/api/audit?"+t),a("waiting").load()]);a("stat-allowed").textContent=String(s.allowed),a("stat-stopped").textContent=String(s.stopped),a("stat-scrubbed").textContent=String(s.scrubbed),a("audit-intro").textContent=i(n===0?"portal.audit.introNone":n===1?"portal.audit.introOne":"portal.audit.intro",{count:n});let r=ea(o).map(d=>{let{entry:p,count:l}=d,k=g(this,"entry",{time:N(p.t),stamp:g(this,"stamp-"+Ye(p),{rule:p.rule}),who:p.mode==="admin"?na(p):p.tool||i("portal.audit.noTool"),where:p.host||p.secret||p.client||"",grouped:l>1,count:"×"+l}),y=k.firstElementChild;return y.dataset.kind=Ye(p),y.dataset.decision=p.mode==="admin"?"admin":p.allow?"allow":"deny",{row:k,item:d}});a("audit-empty").classList.toggle("hidden",r.length>0),A(a("audit"),a("audit-detail"),r,{keyOf:d=>Rs(d.entry),render:d=>Ws(this,d),empty:()=>g(this,"pick")})}});var ia=`<dialog id="kc-dialog" class="modal" data-testid="key-dialog">
  <div class="modal-box max-w-2xl">
    <form method="dialog"><button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" data-i18n-aria-label="portal.keys.close"><span aria-hidden="true">✕</span></button></form>
    <h3 id="kc-title" class="font-bold text-lg mb-3"></h3>
    <div id="kc-slot"></div>
  </div>
  <form method="dialog" class="modal-backdrop"><button tabindex="-1" data-i18n="portal.keys.close"></button></form>
</dialog>
`;m("ks-key-config",{template:ia,wire(){let e=a("kc-dialog");e.addEventListener("submit",V),e.addEventListener("close",V),e.addEventListener("key-done",()=>e.close())}});function la(e,{key:t,kind:s}){a("kc-title").textContent=i(s==="mcp"?"portal.keys.dialogTitleMcp":"portal.keys.dialogTitleWeb"),we(a("kc-slot"),{key:t,kind:s}),a("kc-dialog").showModal()}var ra=`<div class="work-head flex-wrap">
  <div class="min-w-0">
    <h1 class="screen-title" data-i18n="portal.tabs.grants"></h1>
    <p class="max-w-[68ch]" data-i18n="portal.grants.intro"></p>
  </div>
  <div class="flex items-center gap-6">
    <div class="figures">
      <span class="figure"><b id="grants-active" data-testid="grants-active">0</b><span data-i18n="portal.keys.active"></span></span>
      <span class="figure"><b id="grants-expired" data-testid="grants-expired">0</b><span data-i18n="portal.grants.expired"></span></span>
    </div>
    <button id="g-open" class="btn btn-primary btn-sm gap-1.5" data-testid="g-open"><svg class="size-4" aria-hidden="true"><use href="#i-plus"/></svg><span data-i18n="portal.grants.addTitle"></span></button>
  </div>
</div>
<div class="split h-[calc(100vh-15rem)] min-h-[420px]">
  <section class="panel" aria-labelledby="grants-head">
    <div class="panel-head">
      <h2 id="grants-head" data-i18n="portal.tabs.grants"></h2>
      <div class="flex items-center gap-2">
        <select id="g-filter-tool" class="select select-sm w-36 font-mono" data-testid="g-filter-tool" data-i18n-aria-label="portal.grants.filterTool"></select>
        <select id="g-filter-secret" class="select select-sm w-36 font-mono" data-testid="g-filter-secret" data-i18n-aria-label="portal.grants.filterSecret"></select>
      </div>
    </div>
    <div id="grants" class="panel-body rows" role="listbox" data-testid="grants-list" data-i18n-aria-label="portal.tabs.grants"></div>
    <p class="panel-foot muted" data-i18n="portal.grants.footer"></p>
  </section>
  <section id="grant-detail" class="panel" data-testid="grant-detail" data-i18n-aria-label="portal.tabs.grants"></section>
</div>

<!-- Een toekenning toevoegen: niets staat vooraf ingevuld; het domein kies je uit de domeinen van het secret. -->
<dialog id="g-dialog" class="modal" data-testid="g-dialog" aria-labelledby="g-dialog-title">
  <div class="modal-box max-w-2xl">
    <form method="dialog"><button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" data-i18n-aria-label="portal.keys.close"><svg class="size-4" aria-hidden="true"><use href="#i-x"/></svg></button></form>
    <h3 id="g-dialog-title" class="font-bold text-xl flex items-center gap-2 pr-8"><svg class="size-5 text-primary" aria-hidden="true"><use href="#i-plus"/></svg><span data-i18n="portal.grants.addTitle"></span></h3>
    <p class="text-sm opacity-75 mt-1" data-i18n="portal.grants.addIntro"></p>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
      <fieldset class="fieldset"><label class="label" for="g-tool" data-i18n="portal.common.tool"></label><select id="g-tool" class="select w-full font-mono" data-testid="g-tool"></select></fieldset>
      <fieldset class="fieldset"><label class="label" for="g-secret" data-i18n="portal.common.secret"></label><select id="g-secret" class="select w-full font-mono" data-testid="g-secret"></select></fieldset>
      <fieldset class="fieldset"><label class="label" for="g-host" data-i18n="portal.secrets.domain"></label><select id="g-host" class="select w-full font-mono" data-testid="g-host"></select></fieldset>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <fieldset class="fieldset"><label class="label" for="g-mode" data-i18n="portal.common.onUse"></label><select id="g-mode" class="select w-full" data-testid="g-mode">
        <option value="silent" data-i18n="portal.mode.silentLong"></option><option value="notify" data-i18n="portal.mode.notifyLong"></option><option value="confirm" data-i18n="portal.mode.confirmLong"></option>
      </select></fieldset>
      <fieldset class="fieldset"><label class="label" for="g-duration" data-i18n="portal.grants.validFor"></label><select id="g-duration" class="select w-full" data-testid="g-duration">
        <option value="1800000" data-i18n="portal.duration.30m"></option><option value="3600000" data-i18n="portal.duration.1h"></option><option value="14400000" data-i18n="portal.duration.4h"></option><option value="0" data-i18n="portal.duration.always"></option>
      </select><p class="label text-xs whitespace-normal" data-i18n="portal.grants.validHelp"></p></fieldset>
    </div>
    <div class="modal-action">
      <form method="dialog"><button class="btn btn-ghost" data-i18n="portal.ask.cancel"></button></form>
      <button type="button" id="g-add" class="btn btn-primary gap-2" data-testid="g-add"><svg class="size-4" aria-hidden="true"><use href="#i-touch"/></svg><span data-i18n="portal.grants.add"></span></button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop"><button tabindex="-1" data-i18n="portal.keys.close"></button></form>
</dialog>

<!-- Edit: wat er bij gebruik gebeurt, en of de looptijd blijft of verlengd wordt. -->
<dialog id="ge-dialog" class="modal" data-testid="grant-edit-dialog" aria-labelledby="ge-title">
  <div class="modal-box max-w-2xl">
    <form method="dialog"><button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" data-i18n-aria-label="portal.keys.close"><svg class="size-4" aria-hidden="true"><use href="#i-x"/></svg></button></form>
    <h3 id="ge-title" class="font-bold text-xl flex items-center gap-2 pr-8"><svg class="size-5 text-primary" aria-hidden="true"><use href="#i-edit"/></svg><span data-i18n="portal.grants.editTitle"></span></h3>
    <p id="ge-chain" class="mt-2"></p>
    <p id="ge-left" class="mt-2"></p>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
      <fieldset class="fieldset"><label class="label" for="ge-mode" data-i18n="portal.common.onUse"></label><select id="ge-mode" class="select w-full" data-testid="grant-edit-mode">
        <option value="silent" data-i18n="portal.mode.silentLong"></option><option value="notify" data-i18n="portal.mode.notifyLong"></option><option value="confirm" data-i18n="portal.mode.confirmLong"></option>
      </select></fieldset>
      <fieldset class="fieldset"><label class="label" for="ge-extend" data-i18n="portal.grants.extendBy"></label><select id="ge-extend" class="select w-full" data-testid="grant-edit-extend">
        <option value="keep" data-i18n="portal.grants.keep"></option><option value="1800000" data-i18n="portal.grants.plus30m"></option><option value="3600000" data-i18n="portal.grants.plus1h"></option><option value="14400000" data-i18n="portal.grants.plus4h"></option><option value="0" data-i18n="portal.duration.always"></option>
      </select></fieldset>
    </div>
    <div class="modal-action">
      <form method="dialog"><button class="btn btn-ghost" data-i18n="portal.ask.cancel"></button></form>
      <button type="button" id="ge-save" class="btn btn-primary gap-2" data-testid="grant-edit-save"><svg class="size-4" aria-hidden="true"><use href="#i-touch"/></svg><span data-i18n="portal.keys.editSave"></span></button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop"><button tabindex="-1" data-i18n="portal.keys.close"></button></form>
</dialog>

<template data-template="chain">
  <span class="chain"><span class="chain-link"><svg aria-hidden="true"><use href="#i-bot"/></svg><span data-field="tool"></span></span><span class="chain-sep">→</span><span class="chain-link"><svg aria-hidden="true"><use href="#i-key"/></svg><span data-field="secret"></span></span><span class="chain-sep">→</span><span class="chain-link"><svg aria-hidden="true"><use href="#i-globe"/></svg><span data-field="host"></span></span></span>
</template>
<template data-template="row">
  <button type="button" role="option" class="row" data-testid="grant-row-{id}">
    <span data-if-not="expired" class="row-icon"><svg aria-hidden="true"><use href="#i-bot"/></svg></span>
    <span data-if="expired" class="row-icon"><svg aria-hidden="true"><use href="#i-clock"/></svg></span>
    <span class="min-w-0"><span class="row-title"><span data-field="tool"></span> <span class="muted font-normal" data-i18n="portal.grants.uses"></span> <span data-field="secret"></span></span><span class="row-sub" data-field="host"></span></span>
    <span data-if="forever" class="tag" data-i18n="portal.duration.always"></span><span data-if="running" class="tag tag-signal" data-field="left"></span><span data-if="expired" class="tag tag-warn" data-i18n="portal.grants.expired"></span>
  </button>
</template>
<template data-template="detail">
  <article class="detail">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p data-if="forever" class="reading reading-ok" data-i18n="portal.duration.always"></p>
        <p data-if="running" class="reading reading-cool" data-field="left"></p>
        <p data-if="expired" class="reading reading-warn" data-i18n="portal.grants.expired"></p>
        <p class="reading-note" data-field="note"></p>
      </div>
      <div class="flex flex-none flex-wrap justify-end gap-1"><span class="contents" data-field="silence"></span><span class="contents" data-field="pause"></span></div>
    </div>
    <span data-field="chain"></span>
    <dl class="facts">
      <dt data-i18n="portal.common.onUse"></dt><dd data-field="mode"></dd>
      <dt data-i18n="portal.grants.fact.origin"></dt><dd data-field="origin"></dd>
    </dl>
    <p data-if="temporary" class="note note-signal" data-testid="grant-temporary-{id}"><svg aria-hidden="true"><use href="#i-clock"/></svg><span><b class="font-medium" data-field="temporaryLeft"></b> <span data-field="temporaryText"></span></span></p>
    <div class="detail-actions">
      <button class="btn btn-sm btn-ghost text-[var(--bad)] gap-1" data-action="revoke" data-testid="grant-revoke-{id}"><svg class="size-4" aria-hidden="true"><use href="#i-trash"/></svg><span data-i18n="portal.grants.revoke"></span></button>
      <div class="flex gap-2">
        <button data-if="temporary" class="btn btn-sm btn-outline gap-1" data-action="endTemporary" data-testid="grant-end-temporary-{id}"><svg class="size-4" aria-hidden="true"><use href="#i-touch"/></svg><span data-i18n="portal.grants.endTemporary"></span></button>
        <button class="btn btn-sm btn-primary gap-1.5" data-action="edit" data-testid="grant-edit-{id}"><svg class="size-4" aria-hidden="true"><use data-icon href="#i-edit"/></svg><span data-field="editLabel"></span></button>
      </div>
    </div>
  </article>
</template>
<template data-template="left">
  <span class="flex items-center gap-2">
    <span data-if="forever" class="tag"><svg class="size-3" aria-hidden="true"><use href="#i-clock"/></svg><span data-i18n="portal.duration.always"></span></span>
    <span data-if="running" class="tag tag-signal"><svg class="size-3" aria-hidden="true"><use href="#i-clock"/></svg><span data-field="left"></span></span>
    <span data-if="expired" class="tag tag-warn"><svg class="size-3" aria-hidden="true"><use href="#i-clock"/></svg><span data-i18n="portal.grants.expired"></span></span>
    <span class="text-xs muted" data-field="origin"></span>
  </span>
</template>
<template data-template="empty"><p class="p-4 muted" data-testid="grants-empty" data-i18n="portal.grants.empty"></p></template>
<template data-template="pick"><p class="p-6 muted" data-i18n="portal.grants.pick"></p></template>
`;var Ze=6e4,F=e=>e<90*Ze?i("portal.grants.leftMin",{n:Math.max(1,Math.round(e/Ze))}):i("portal.grants.leftHours",{n:Math.round(e/(60*Ze))});function da(e=[]){let t=e.find(r=>r.id===a("g-tool").value),s=t&&(t.onUse!=="silent"||t.validMs>0);a("g-mode").value=s?t.onUse:"notify";let o=s?String(t.validMs):"3600000",n=a("g-duration").querySelector('option[value="0"]');n.disabled=!!t&&!t.rotating,[...a("g-duration").options].some(r=>r.value===o&&!r.disabled)?a("g-duration").value=o:a("g-duration").selectedOptions[0]?.disabled&&(a("g-duration").value="14400000")}function Qe(e=[]){let s=(e.find(o=>o.name===a("g-secret").value)?.hosts??[]).map(o=>[w(o),o]);D(a("g-host"),s.length>1?[...s,[i("portal.grants.allDomains"),"*"]]:s,!1,i("portal.grants.chooseDomain"))}var ca=(e,t)=>g(e,"chain",{tool:t.toolName,secret:t.secretName,host:w(t.host)});function _s(e,t){let s=t.expiresAt?t.expiresAt-Date.now():null;return g(e,"left",{forever:!t.expiresAt,running:s>0,expired:s!==null&&s<=0,left:s>0?F(s):"",origin:i(t.origin==="tray"?"portal.grants.fromTray":"portal.grants.fromPortal")})}function $s(e,t){a("ge-chain").replaceChildren(ca(e,t)),a("ge-left").replaceChildren(_s(e,t)),a("ge-mode").value=t.mode??"silent",a("ge-extend").value=t.expiresAt&&t.expiresAt>Date.now()?"keep":"3600000",a("ge-dialog").onsave=async()=>{let s=a("ge-extend").value,o=s==="keep"?void 0:s==="0"?0:Math.max(t.expiresAt??0,Date.now())+Number(s)-Date.now();await c("PUT","/api/grants/"+t.id,{mode:a("ge-mode").value,...o!==void 0?{durationMs:o}:{}}),a("ge-dialog").close(),await e.load()},a("ge-dialog").showModal()}function Js(e,t,s){let o=(s?.grants??[]).find(n=>n.grantId===t.id);return oe({id:"grant-silence-"+t.toolName+"-"+t.secretName,kind:"silence",until:o?o.until:void 0,pause:async n=>{await c("POST","/api/snooze/grant",{grantId:t.id,until:n}),await e.load()},resume:async()=>{await c("DELETE","/api/snooze/grant/"+t.id),await e.load()}})}m("ks-grants",{template:ra,wire(){this.openAdd=({toolName:e="",secretName:t="",host:s="",newHost:o=!1}={})=>{if(a("g-tool").value=this.tools?.find(n=>n.name===e)?.id??"",a("g-secret").value=this.secrets?.some(n=>n.name===t)?t:"",Qe(this.secrets),da(this.tools),o&&a("g-secret").value&&![...a("g-host").options].some(n=>n.value===s)){let n=new Option(i("portal.grants.newDomain",{host:w(s)}),s);n.dataset.new="1",a("g-host").append(n)}[...a("g-host").options].some(n=>n.value===s)&&(a("g-host").value=s),a("g-dialog").showModal()},h("g-open",()=>this.openAdd()),h("g-add",async()=>{let e=this.secrets.find(o=>o.name===a("g-secret").value),t=a("g-host").value==="*"?e.hosts:[a("g-host").value],s=a("g-host").selectedOptions[0]?.dataset.new==="1"?{addHost:!0}:{};for(let o of t)await c("POST","/api/grants",{toolId:a("g-tool").value,secretName:a("g-secret").value,host:o,durationMs:Number(a("g-duration").value),mode:a("g-mode").value,...s});a("g-dialog").close(),await this.load()}),h("ge-save",()=>a("ge-dialog").onsave());for(let e of["g-filter-tool","g-filter-secret"])a(e).addEventListener("change",()=>v(()=>this.load()));a("g-tool").addEventListener("change",()=>da(this.tools)),a("g-secret").addEventListener("change",()=>Qe(this.secrets))},async load(){let[e,t,s,o]=await Promise.all([c("GET","/api/tools"),c("GET","/api/secrets"),c("GET","/api/blocks"),c("GET","/api/snooze")]);this.tools=e,this.secrets=t;let n=e.map(u=>[u.name,u.id]),r=t.map(u=>[u.name,u.name]);D(a("g-tool"),n,!1,i("portal.grants.chooseTool")),D(a("g-secret"),r,!1,i("portal.grants.chooseSecret")),Qe(t),D(a("g-filter-tool"),n,i("portal.grants.allTools")),D(a("g-filter-secret"),r,i("portal.grants.allSecrets"));let d=new URLSearchParams({tool:a("g-filter-tool").value,secret:a("g-filter-secret").value}),p=await c("GET","/api/grants?"+d),l=u=>{let E=u.expiresAt?u.expiresAt-Date.now():null;return{forever:!u.expiresAt,running:E>0,expired:E!==null&&E<=0,left:E>0?F(E):""}},k=u=>u.toolName+"-"+u.secretName,y=u=>{let E=l(u),I=!!u.overrideUntil&&u.overrideUntil>Date.now(),le=g(this,"detail",{...E,id:k(u),chain:ca(this,u),note:E.running?i("portal.grants.noteRunning",{time:N(u.expiresAt)}):i(E.expired?"portal.grants.noteExpired":"portal.grants.noteAlways"),pause:R("grant-block-"+k(u),s,{kind:"grant",toolId:u.toolId,secretName:u.secretName,host:u.host},()=>this.load()),silence:u.mode==="notify"?Js(this,u,o):"",mode:i("portal.mode."+(u.mode??"silent")+"Long"),origin:i(u.origin==="tray"?"portal.grants.fromTray":"portal.grants.fromPortal"),editLabel:i(E.expired?"portal.grants.renew":"portal.keys.edit"),temporary:I,temporaryLeft:I?F(u.overrideUntil-Date.now()):"",temporaryText:I?i("portal.grants.temporary",{mode:i("portal.mode."+u.overrideMode+"Long")}):""},{endTemporary:async()=>{await c("PUT","/api/grants/"+u.id,{endOverride:!0}),await this.load()},edit:()=>$s(this,u),revoke:async()=>{await x(i("portal.grants.revokeConfirm",{chain:u.toolName+" → "+u.secretName+" → "+w(u.host)}),{ok:"portal.grants.revoke"})&&(await c("DELETE","/api/grants/"+u.id),await this.load())}});return E.expired&&le.querySelector("[data-icon]").setAttribute("href","#i-rotate"),le},b=p.map(u=>({row:g(this,"row",{...l(u),id:k(u),tool:u.toolName,secret:u.secretName,host:w(u.host)}),item:u}));a("grants-active").textContent=String(p.filter(u=>!l(u).expired).length),a("grants-expired").textContent=String(p.filter(u=>l(u).expired).length),A(a("grants"),a("grant-detail"),b,{keyOf:u=>u.id,render:y,empty:()=>g(this,"pick")}),b.length||a("grants").replaceChildren(g(this,"empty"))}});var pa=`<div class="work-head flex-wrap">
  <div>
    <h1 class="screen-title" data-i18n="portal.tabs.keys"></h1>
    <p data-i18n="portal.keys.intro"></p>
  </div>
  <div class="flex items-center gap-6">
    <div class="figures">
      <span class="figure"><b id="tools-active" data-testid="tools-active">0</b><span data-i18n="portal.keys.active"></span></span>
      <span class="figure"><b id="tools-revoked" data-testid="tools-revoked">0</b><span data-i18n="portal.keys.revoked"></span></span>
    </div>
    <button id="tools-create" class="btn btn-primary btn-sm gap-1.5" data-testid="tools-create"><svg class="size-4" aria-hidden="true"><use href="#i-plus"/></svg><span data-i18n="portal.keys.create"></span></button>
  </div>
</div>
<!-- Een tool die wil koppelen, wacht hier op jou (zoals de mockups: bovenaan Virtual keys). -->
<div id="tools-waiting" class="note note-signal hidden" data-testid="tools-waiting">
  <svg aria-hidden="true"><use href="#i-link"/></svg>
  <div class="min-w-0 flex-1 space-y-2">
    <p class="font-medium text-[var(--ink)]" data-i18n="portal.keys.waiting"></p>
    <p data-i18n="portal.keys.waitingHelp"></p>
    <div id="tools-device-slot"></div>
  </div>
</div>
<!-- Create key: een dialoog (mockup 08) met ks-key-create, hetzelfde component als stap 3 van het welkom. -->
<dialog id="tools-create-card" class="modal" data-testid="tools-create-card" aria-labelledby="tools-create-title">
  <div class="modal-box max-w-2xl max-h-[90vh] overflow-y-auto">
    <form method="dialog"><button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" data-i18n-aria-label="portal.keys.close"><svg class="size-4" aria-hidden="true"><use href="#i-x"/></svg></button></form>
    <h3 id="tools-create-title" class="mb-4 pr-8 text-xl" data-i18n="portal.keys.newTitle"></h3>
    <div id="tools-ways-slot"></div>
  </div>
  <form method="dialog" class="modal-backdrop"><button tabindex="-1" data-i18n="portal.keys.close"></button></form>
</dialog>
<div class="split h-[calc(100vh-15rem)] min-h-[420px]">
  <section class="panel" aria-labelledby="tools-head">
    <div class="panel-head"><h2 id="tools-head" data-i18n="portal.keys.tools"></h2><span id="tools-count"></span></div>
    <div id="tools" class="panel-body rows" role="listbox" data-testid="tools-list" data-i18n-aria-label="portal.keys.tools"></div>
  </section>
  <section id="tools-detail" class="panel" data-testid="tool-detail" data-i18n-aria-label="portal.tabs.keys"></section>
</div>

<dialog id="tools-edit" class="modal" data-testid="tool-edit-dialog">
  <div class="modal-box max-w-lg">
    <form method="dialog"><button class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" data-i18n-aria-label="portal.keys.close"><span aria-hidden="true">✕</span></button></form>
    <h3 id="te-title" class="font-bold text-lg"></h3>
    <fieldset class="fieldset mt-3"><label class="label" for="te-name" data-i18n="portal.keys.editName"></label><input id="te-name" class="input w-full font-mono" data-testid="tool-edit-name"></fieldset>
    <label class="flex items-center gap-3 text-sm mt-3"><input id="te-other" type="checkbox" class="toggle toggle-primary toggle-sm" data-testid="tool-edit-other"><span data-i18n="portal.keys.editOther"></span></label>
    <input id="te-clients" class="input w-full font-mono mt-2 fade-in hidden" placeholder="192.168.1.20, 10.0.0.0/24" data-testid="tool-edit-clients" data-i18n-aria-label="portal.keys.clients">
    <fieldset class="fieldset mt-3"><label class="label" for="te-reask" data-i18n="portal.keys.reask"></label><select id="te-reask" class="select w-full" data-testid="tool-edit-reask"></select><p class="label text-xs whitespace-normal" data-i18n="portal.keys.reaskHelp"></p></fieldset>
    <div class="modal-action">
      <form method="dialog"><button class="btn btn-ghost" data-i18n="portal.ask.cancel"></button></form>
      <button type="button" id="te-save" class="btn btn-primary" data-testid="tool-edit-save" data-i18n="portal.keys.editSave"></button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop"><button tabindex="-1" data-i18n="portal.keys.close"></button></form>
</dialog>

<!-- Eigen sjablonen in een eigen vak: "Create key" bevat andere onderdelen met een sjabloon "row". -->
<div id="tools-templates" hidden>
<template data-template="row">
  <button type="button" role="option" class="row" data-testid="tool-row-{name}">
    <span data-if="mcp" class="row-icon"><svg aria-hidden="true"><use href="#i-plug"/></svg></span>
    <span data-if-not="mcp" class="row-icon"><svg aria-hidden="true"><use href="#i-globe"/></svg></span>
    <span class="min-w-0">
      <span data-if-not="revoked" class="row-title mono" data-field="name"></span><span data-if="revoked" class="row-title mono muted line-through" data-field="name"></span>
      <span data-if="mcp" class="row-note" data-i18n="portal.keys.kindMcp"></span><span data-if-not="mcp" class="row-note" data-i18n="portal.keys.kindWeb"></span>
    </span>
    <span data-if="revoked" class="tag tag-bad" data-i18n="portal.keys.revoked"></span><span data-if-not="revoked" class="tag" data-i18n="portal.keys.active"></span>
  </button>
</template>
<template data-template="detail">
  <article class="detail">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="reading" data-field="name" translate="no"></p>
        <!-- Wat Vaultgate voor deze key doet, en wat niet (eerlijk restrisico). -->
        <p data-if="rotating" class="reading-note" data-testid="tool-rotation-help-{name}" data-i18n="portal.keys.rotatingHelp"></p>
        <p data-if-not="rotating" class="reading-note" data-testid="tool-rotation-help-{name}" data-i18n="portal.keys.manualHelp"></p>
      </div>
      <!-- Rechtsboven: het blokkeermenu klapt dan binnen het detailvak open (onderaan of links knipt het scrollvak het af). -->
      <div class="flex-none" data-field="pause"></div>
    </div>
    <dl class="facts">
      <dt data-i18n="portal.keys.kind"></dt><dd><span data-if="mcp" data-i18n="portal.keys.kindMcp"></span><span data-if-not="mcp" data-i18n="portal.keys.kindWeb"></span></dd>
      <dt data-i18n="portal.keys.fact.from"></dt><dd data-field="clients"></dd>
      <dt data-i18n="portal.keys.domains"></dt><dd class="mono" data-field="domains"></dd>
      <dt data-i18n="portal.keys.fact.key"></dt><dd><span data-field="since"></span>
        <span data-if="rotating" class="tag tag-signal ml-1" data-testid="tool-rotation-{name}" data-i18n="portal.keys.rotating"></span>
        <span data-if-not="rotating" class="tag tag-warn ml-1" data-testid="tool-rotation-{name}" data-i18n="portal.keys.manual"></span></dd>
    </dl>
    <div>
      <p class="section-label" data-i18n="portal.keys.grants"></p>
      <div class="rows rounded-lg border border-[var(--line)]" data-field="grants"></div>
    </div>
    <div class="detail-actions">
      <button class="btn btn-sm btn-ghost text-[var(--bad)]" data-if-not="revoked" data-action="revoke" data-testid="tool-revoke-{name}" data-i18n="portal.keys.revoke"></button>
      <button class="btn btn-sm btn-outline gap-1" data-if="revoked" data-action="reactivate" data-testid="tool-reactivate-{name}"><svg class="size-4" aria-hidden="true"><use href="#i-touch"/></svg><span data-i18n="portal.keys.reactivate"></span></button>
      <div class="flex gap-2">
        <button class="btn btn-sm btn-outline gap-1.5" data-action="edit" data-testid="tool-edit-{name}"><svg class="size-4" aria-hidden="true"><use href="#i-edit"/></svg><span data-i18n="portal.keys.edit"></span></button>
        <button class="btn btn-sm btn-primary gap-1.5" data-action="rotate" data-testid="tool-rotate-{name}"><svg class="size-4" aria-hidden="true"><use href="#i-touch"/></svg><span data-i18n="portal.keys.rotate"></span></button>
      </div>
    </div>
  </article>
</template>
<template data-template="grant">
  <div class="flex items-center justify-between gap-3 px-3 py-2">
    <span class="chain"><span class="chain-link"><svg aria-hidden="true"><use href="#i-key"/></svg><span data-field="secret"></span></span><span class="chain-sep">→</span><span class="chain-link"><svg aria-hidden="true"><use href="#i-globe"/></svg><span data-field="host"></span></span></span>
    <span class="text-sm muted" data-field="left"></span>
  </div>
</template>
<template data-template="no-grants"><p class="px-3 py-2 text-sm muted" data-i18n="portal.keys.noDomains"></p></template>
<template data-template="empty"><p class="p-4 muted" data-testid="tools-empty"><span data-i18n="portal.keys.empty"></span></p></template>
<template data-template="pick"><p class="p-6 muted" data-i18n="portal.keys.pick"></p></template>
</div>
`;var et=()=>a("tools-create-card").open,ua=async()=>{et()||a("tools-create-card").showModal(),await j("ks-key-create",a("tools-ways-slot")).load()};async function ga(){if(et()){a("tools-waiting").classList.add("hidden");return}await j("ks-device-list",a("tools-device-slot")).load(),a("tools-waiting").classList.toggle("hidden",a("device").children.length===0)}var Zs=[0,1,4,8,24],Qs=e=>Zs.map(t=>{let s=new Option(t?i("portal.keys.reaskHours",{hours:t}):i("portal.keys.reaskOff"),String(t*36e5));return s.selected=t*36e5===e,s});function Xs(e,t){let s=e.clients.length>0;a("te-reask").replaceChildren(...Qs(e.reaskMs)),a("te-title").textContent=i("portal.keys.editTitle",{name:e.name}),a("te-name").value=e.name,a("te-other").checked=s,a("te-clients").value=e.clients.join(", "),a("te-clients").classList.toggle("hidden",!s),a("tools-edit").onsave=async()=>{let o=a("te-name").value.trim();o!==e.name&&await c("PUT","/api/tools/"+e.id+"/name",{name:o}),await c("PUT","/api/tools/"+e.id+"/clients",{clients:a("te-other").checked?P(a("te-clients").value):[]});let n=Number(a("te-reask").value);n!==e.reaskMs&&await c("PUT","/api/tools/"+e.id+"/reask",{reaskMs:n}),a("tools-edit").close(),await t()},a("tools-edit").showModal()}m("ks-tools",{template:pa,wire(){h("tools-create",async()=>{await ua(),await ga()}),h("te-save",()=>a("tools-edit").onsave()),a("te-other").addEventListener("change",()=>a("te-clients").classList.toggle("hidden",!a("te-other").checked)),this.addEventListener("key-created",()=>this.loadList()),this.addEventListener("tool-connected",()=>this.loadList()),this.addEventListener("key-done",()=>a("tools-create-card").close()),a("tools-create-card").addEventListener("close",()=>v(()=>(V(),B(),this.load()))),this.addEventListener("tool-paired",()=>this.load()),this.loadList=()=>Xe(this)},async load(){et()&&await ua(),await Promise.all([ga(),Xe(this)])}});var eo=(e,t)=>g(e,"grant",{secret:t.secretName,host:w(t.host),left:t.expiresAt?t.expiresAt>Date.now()?F(t.expiresAt-Date.now()):i("portal.grants.expired"):i("portal.duration.always")});async function Xe(e){let[t,s,o]=await Promise.all([c("GET","/api/tools"),c("GET","/api/grants"),c("GET","/api/blocks")]),n=a("tools-templates"),r=()=>e.load(),d=l=>{let k=s.filter(u=>u.toolId===l.id||u.toolName===l.name),y=[...new Set(k.map(u=>w(u.host)))].sort(),b=document.createDocumentFragment();return b.append(...k.length?k.map(u=>eo(n,u)):[g(n,"no-grants")]),g(n,"detail",{name:l.name,mcp:l.kind==="mcp",revoked:l.revoked,rotating:l.rotating,grants:b,domains:y.length?y.join(", "):i("portal.keys.noDomains"),clients:l.clients.length?i("portal.keys.thisPcAnd",{list:l.clients.join(", ")}):i("portal.keys.thisPcOnly"),pause:l.revoked?"":R("tool-block-"+l.name,o,{kind:"tool",toolId:l.id},r),since:i("portal.keys.created",{date:C(l.createdAt)})},{edit:()=>Xs(l,r),rotate:async()=>{if(!await x(i("portal.keys.rotateConfirm",{name:l.name}),{ok:"portal.keys.rotate",warning:i("portal.keys.rotateWarning")}))return;let u=await c("POST","/api/tools/"+l.id+"/rotate");la(a("key-config"),{key:u.key,kind:l.kind}),await Xe(e)},reactivate:async()=>{await x(i("portal.keys.reactivateConfirm",{name:l.name}),{ok:"portal.keys.reactivate"})&&(await c("POST","/api/tools/"+l.id+"/reactivate"),await r())},revoke:async()=>{await x(i("portal.keys.revokeConfirm",{name:l.name}),{ok:"portal.keys.revoke"})&&(await c("POST","/api/tools/"+l.id+"/revoke"),await r())}})},p=t.map(l=>({row:g(n,"row",{name:l.name,mcp:l.kind==="mcp",revoked:l.revoked}),item:l}));a("tools-active").textContent=String(t.filter(l=>!l.revoked).length),a("tools-revoked").textContent=String(t.filter(l=>l.revoked).length),a("tools-count").textContent=i("portal.keys.count",{count:t.length}),A(a("tools"),a("tools-detail"),p,{keyOf:l=>l.id,render:d,empty:()=>g(n,"pick")}),p.length||a("tools").replaceChildren(g(n,"empty"))}var ma=`<div class="work-head flex-wrap">
  <div class="min-w-0">
    <h1 class="screen-title" data-i18n="portal.tabs.secrets"></h1>
    <p class="max-w-[68ch]" data-i18n="portal.secrets.intro"></p>
  </div>
  <div class="flex items-center gap-6">
    <div class="figures">
      <span class="figure"><b id="secrets-total" data-testid="secrets-total">0</b><span data-i18n="portal.secrets.figVault"></span></span>
      <span class="figure"><b id="secrets-sensitive" data-testid="secrets-sensitive">0</b><span data-i18n="portal.secrets.sensitiveBadge"></span></span>
    </div>
    <button id="s-open" class="btn btn-primary btn-sm gap-1.5" data-testid="s-open"><svg class="size-4" aria-hidden="true"><use href="#i-plus"/></svg><span data-i18n="portal.secrets.addTitle"></span></button>
  </div>
</div>
<div class="split h-[calc(100vh-15rem)] min-h-[420px]">
  <section class="panel" aria-labelledby="secrets-head">
    <div class="panel-head"><h2 id="secrets-head" data-i18n="portal.secrets.vault"></h2><span id="secrets-count"></span></div>
    <div id="secrets" class="panel-body rows" role="listbox" data-testid="secrets-list" data-i18n-aria-label="portal.secrets.vault"></div>
    <p class="panel-foot muted" data-i18n="portal.secrets.footer"></p>
  </section>
  <section id="secret-detail" class="panel" data-testid="secret-detail" data-i18n-aria-label="portal.tabs.secrets"></section>
</div>

<!-- Een secret toevoegen: de waarde gaat erin en komt er nooit meer uit. -->
<dialog id="s-dialog" class="modal" data-testid="s-dialog" aria-labelledby="s-dialog-title">
  <div class="modal-box max-w-2xl">
    <form method="dialog"><button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" data-i18n-aria-label="portal.keys.close"><svg class="size-4" aria-hidden="true"><use href="#i-x"/></svg></button></form>
    <h3 id="s-dialog-title" class="font-bold text-xl flex items-center gap-2 pr-8"><svg class="size-5 text-primary" aria-hidden="true"><use href="#i-plus"/></svg><span data-i18n="portal.secrets.addTitle"></span></h3>
    <p class="text-sm opacity-75 mt-1" data-i18n="portal.secrets.addIntro"></p>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4" role="radiogroup" aria-label="Kind">
      <button type="button" id="s-pick-key" class="choice-card text-left" role="radio" aria-checked="true" data-testid="s-pick-key" data-pick="key"><svg class="size-6 text-primary shrink-0 mt-0.5" aria-hidden="true"><use href="#i-key"/></svg><span><span class="block font-semibold" data-i18n="portal.secrets.kindKey"></span><span class="block text-xs opacity-70" data-i18n="portal.secrets.kindKeyHelp"></span></span></button>
      <button type="button" id="s-pick-login" class="choice-card text-left opacity-75" role="radio" aria-checked="false" data-testid="s-pick-login" data-pick="login"><svg class="size-6 text-primary shrink-0 mt-0.5" aria-hidden="true"><use href="#i-user"/></svg><span><span class="block font-semibold" data-i18n="portal.secrets.kindLogin"></span><span class="block text-xs opacity-70" data-i18n="portal.secrets.kindLoginHelp"></span></span></button>
      <div class="choice-card opacity-50 cursor-not-allowed text-left" aria-disabled="true"><svg class="size-6 text-primary shrink-0 mt-0.5" aria-hidden="true"><use href="#i-link"/></svg><span><span class="block font-semibold" data-i18n="portal.secrets.kindService"></span><span class="block text-xs opacity-70" data-i18n="portal.secrets.later"></span></span></div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
      <fieldset class="fieldset"><label class="label" for="s-name" data-i18n="portal.common.name"></label><input id="s-name" placeholder="openai" class="input w-full font-mono" data-testid="s-name"></fieldset>
      <fieldset class="fieldset"><label class="label" for="s-hosts" data-i18n="portal.secrets.domain"></label><input id="s-hosts" placeholder="api.openai.com" class="input w-full font-mono" data-testid="s-hosts"><p class="text-xs text-info mt-1 whitespace-normal" data-i18n="portal.secrets.domainHelp"></p></fieldset>
    </div>
    <div id="s-panel-key" class="flex flex-col gap-3">
      <fieldset class="fieldset"><label class="label" for="s-value" data-i18n="portal.secrets.value"></label>
        <div class="join w-full"><input id="s-value" type="password" autocomplete="new-password" class="input join-item w-full font-mono" data-testid="s-value"><button type="button" class="btn join-item" data-reveal data-testid="s-reveal" data-i18n-aria-label="portal.ask.show"><svg class="size-4" aria-hidden="true"><use href="#i-eye"/></svg></button></div>
        <p class="text-xs text-warning flex items-center gap-1.5 mt-1"><svg class="size-3.5" aria-hidden="true"><use href="#i-warn"/></svg><span data-i18n="portal.secrets.never"></span></p>
        <p class="text-xs opacity-70 mt-1" data-testid="secret-clipboard-note" data-i18n="portal.secrets.clipboardNote"></p></fieldset>
    </div>
    <div id="s-panel-login" class="flex flex-col gap-3 hidden">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <fieldset class="fieldset"><label class="label" for="s-username" data-i18n="portal.secrets.username"></label><input id="s-username" placeholder="user@example.com" class="input w-full font-mono" data-testid="s-username"></fieldset>
        <fieldset class="fieldset"><label class="label" for="s-password" data-i18n="portal.secrets.password"></label>
          <div class="join w-full"><input id="s-password" type="password" autocomplete="new-password" class="input join-item w-full font-mono" data-testid="s-password"><button type="button" class="btn join-item" data-reveal data-testid="s-password-reveal" data-i18n-aria-label="portal.ask.show"><svg class="size-4" aria-hidden="true"><use href="#i-eye"/></svg></button></div>
        </fieldset>
      </div>
      <p class="text-xs text-warning flex items-center gap-1.5 mt-1"><svg class="size-3.5" aria-hidden="true"><use href="#i-warn"/></svg><span data-i18n="portal.secrets.never"></span></p>
      <p class="text-xs opacity-70 mt-1" data-i18n="portal.secrets.clipboardNote"></p>
    </div>
    <label class="sensitive-box"><input id="s-sensitive" type="checkbox" class="toggle toggle-primary mt-0.5" checked data-testid="s-sensitive"><span class="text-sm flex-1"><span class="flex items-center gap-2"><b data-i18n="portal.secrets.sensitive"></b><span class="badge badge-primary badge-sm" data-i18n="portal.secrets.on"></span><span class="opacity-60 text-xs" data-i18n="portal.secrets.recommended"></span></span><span class="opacity-75" data-i18n="portal.secrets.sensitiveHelp"></span></span></label>
    <div class="modal-action">
      <form method="dialog"><button class="btn btn-ghost" data-i18n="portal.ask.cancel"></button></form>
      <button type="button" id="s-add" class="btn btn-primary" data-testid="s-add" data-i18n="portal.secrets.add"></button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop"><button tabindex="-1" data-i18n="portal.keys.close"></button></form>
</dialog>

<!-- Edit: alles behalve de waarde (daarvoor is er Rotate). -->
<dialog id="se-dialog" class="modal" data-testid="secret-edit-dialog" aria-labelledby="se-title">
  <div class="modal-box max-w-2xl">
    <form method="dialog"><button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" data-i18n-aria-label="portal.keys.close"><svg class="size-4" aria-hidden="true"><use href="#i-x"/></svg></button></form>
    <h3 id="se-title" class="font-bold text-xl flex items-center gap-2 pr-8"></h3>
    <p class="text-sm opacity-75 mt-1" data-i18n="portal.secrets.editIntro"></p>
    <fieldset class="fieldset mt-3"><label class="label" for="se-name" data-i18n="portal.common.name"></label><input id="se-name" class="input w-full font-mono" data-testid="secret-edit-name">
      <p id="se-name-warning" class="text-xs text-warning flex items-center gap-1.5 mt-1 hidden" data-testid="secret-edit-name-warning"><svg class="size-3.5 shrink-0" aria-hidden="true"><use href="#i-warn"/></svg><span id="se-name-warning-text"></span></p></fieldset>
    <fieldset class="fieldset"><label class="label" for="se-add" data-i18n="portal.secrets.domains"></label>
      <div class="flex flex-wrap items-center gap-2 rounded-field border border-base-content/20 p-2">
        <span id="se-chips" class="contents"></span>
        <input id="se-add" class="input input-ghost input-sm flex-1 min-w-32 font-mono" data-testid="secret-edit-add" data-i18n-placeholder="portal.secrets.addDomain" data-i18n-aria-label="portal.secrets.addDomain">
      </div><p class="text-xs text-info mt-1 whitespace-normal" data-i18n="portal.secrets.domainHelp"></p></fieldset>
    <fieldset id="se-places-box" class="fieldset"><label class="label" data-i18n="portal.secrets.places"></label>
      <div class="flex flex-wrap items-center gap-2"><span id="se-places" class="contents"></span><span id="se-places-empty" class="text-sm opacity-70 hidden" data-testid="secret-places-empty" data-i18n="portal.secrets.learning"></span></div>
      <p class="text-xs opacity-70 mt-1 whitespace-normal" data-i18n="portal.secrets.placesHelp"></p></fieldset>
    <label class="sensitive-box"><input id="se-sensitive" type="checkbox" class="toggle toggle-primary mt-0.5" data-testid="secret-edit-sensitive"><span class="text-sm flex-1"><span class="flex items-center gap-2"><b data-i18n="portal.secrets.sensitive"></b><span class="badge badge-primary badge-sm" data-i18n="portal.secrets.on"></span><span class="opacity-60 text-xs" data-i18n="portal.secrets.recommended"></span></span><span class="opacity-75" data-i18n="portal.secrets.sensitiveHelp"></span></span></label>
    <div class="modal-action">
      <form method="dialog"><button class="btn btn-ghost" data-i18n="portal.ask.cancel"></button></form>
      <button type="button" id="se-save" class="btn btn-primary" data-testid="secret-edit-save" data-i18n="portal.keys.editSave"></button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop"><button tabindex="-1" data-i18n="portal.keys.close"></button></form>
</dialog>

<template data-template="row">
  <button type="button" role="option" class="row" data-testid="secret-row-{name}">
    <span class="row-icon">
      <svg data-if="isKey" aria-hidden="true"><use href="#i-key"/></svg>
      <svg data-if="isLogin" aria-hidden="true"><use href="#i-user"/></svg>
    </span>
    <span class="min-w-0"><span class="row-title mono" data-field="name"></span><span class="row-sub" data-field="host"></span></span>
    <span class="flex gap-1.5"><span data-if="sensitive" class="tag tag-warn" data-testid="sensitive-badge-{name}" data-i18n="portal.secrets.sensitiveBadge"></span><span class="tag" data-field="grantCount"></span></span>
  </button>
</template>
<template data-template="detail">
  <article class="detail">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="reading" data-field="name" translate="no"></p>
        <p class="reading-note" data-field="kindNote"></p>
      </div>
      <div class="flex-none" data-field="pause"></div>
    </div>
    <dl class="facts">
      <dt data-i18n="portal.secrets.fact.domain"></dt><dd class="mono" data-field="host"></dd>
      <dt data-if="subdomains" data-i18n="portal.secrets.fact.subdomains"></dt><dd data-if="subdomains" class="mono" data-field="subdomains"></dd>
      <dt data-i18n="portal.secrets.places"></dt><dd data-field="inject"></dd>
      <dt data-i18n="portal.secrets.fact.touch"></dt><dd><span data-if="sensitive" class="tag tag-warn mr-1" data-i18n="portal.secrets.sensitiveBadge"></span><span data-field="touch"></span></dd>
      <dt data-i18n="portal.secrets.value"></dt><dd data-field="updated"></dd>
    </dl>
    <div>
      <p class="section-label" data-i18n="portal.keys.grants"></p>
      <div class="rows rounded-lg border border-[var(--line)]" data-field="grants"></div>
    </div>
    <div class="detail-actions">
      <button class="btn btn-sm btn-ghost text-[var(--bad)] gap-1" data-action="revoke" data-testid="revoke-{name}"><svg class="size-4" aria-hidden="true"><use href="#i-trash"/></svg><span data-i18n="portal.secrets.revoke"></span></button>
      <div class="flex gap-2">
        <button class="btn btn-sm btn-outline gap-1.5" data-action="edit" data-testid="edit-{name}"><svg class="size-4" aria-hidden="true"><use href="#i-edit"/></svg><span data-i18n="portal.keys.edit"></span></button>
        <button class="btn btn-sm btn-primary gap-1.5" data-action="rotate" data-testid="rotate-{name}"><svg class="size-4" aria-hidden="true"><use href="#i-touch"/></svg><span data-i18n="portal.secrets.rotate"></span></button>
      </div>
    </div>
  </article>
</template>
<template data-template="grant">
  <div class="flex items-center justify-between gap-3 px-3 py-2">
    <span class="chain"><span class="chain-link"><svg aria-hidden="true"><use href="#i-bot"/></svg><span data-field="tool"></span></span><span class="chain-sep">→</span><span class="chain-link"><svg aria-hidden="true"><use href="#i-globe"/></svg><span data-field="host"></span></span></span>
    <span class="text-sm muted" data-field="left"></span>
  </div>
</template>
<template data-template="no-grants"><p class="px-3 py-2 text-sm muted" data-i18n="portal.secrets.grantsNone"></p></template>
<template data-template="pick"><p class="p-6 muted" data-i18n="portal.secrets.pick"></p></template>
<template data-template="empty"><p class="p-4 muted" data-testid="secrets-empty" data-i18n="portal.secrets.empty"></p></template>
<template data-template="place"><span class="badge badge-outline gap-1 font-mono" data-testid="secret-place-{place}"><span data-field="place"></span><button type="button" data-action="remove" data-testid="secret-place-remove-{place}" data-i18n-aria-label="portal.secrets.removeDomain">×</button></span></template>
<template data-template="chip"><span class="badge gap-1 font-mono" data-testid="secret-chip-{host}"><span data-field="host"></span><button type="button" data-action="remove" data-testid="secret-chip-remove-{host}" data-i18n-aria-label="portal.secrets.removeDomain">×</button></span></template>
`;var ao=e=>i(e===0?"portal.secrets.grantsNone":e===1?"portal.secrets.grantsOne":"portal.secrets.grants",{count:e});function so(e,t){let s=[...t.hosts],o=()=>a("se-chips").replaceChildren(...s.map((d,p)=>{let l=g(e,"chip",{host:w(d)},{remove:()=>{s=s.filter(k=>k!==d),o()}});return l.classList.add(p===0?"badge-primary":"badge-outline"),s.length===1&&l.querySelector("button").remove(),l})),n=t.inject?[...t.inject]:null,r=()=>{a("se-places").replaceChildren(...(n??[]).map(d=>g(e,"place",{place:d},{remove:()=>{n=n.filter(p=>p!==d),r()}}))),a("se-places-empty").classList.toggle("hidden",n?.length!==0)};a("se-places-box").classList.toggle("hidden",!n),r(),a("se-title").textContent=i("portal.secrets.editTitle",{name:t.name}),a("se-sensitive").checked=t.sensitive,a("se-name").value=t.name,a("se-name-warning-text").textContent=i("portal.secrets.renameWarning",{old:t.name}),a("se-name").oninput=()=>a("se-name-warning").classList.toggle("hidden",a("se-name").value.trim()===t.name),a("se-name-warning").classList.add("hidden"),a("se-add").value="",a("se-add").onkeydown=d=>{d.key!=="Enter"||!a("se-add").value.trim()||(d.preventDefault(),s=[...new Set([...s,...P(a("se-add").value)])],a("se-add").value="",o())},a("se-dialog").onsave=async()=>{s=[...new Set([...s,...P(a("se-add").value)])];let d=a("se-name").value.trim();d!==t.name&&await c("PUT","/api/secrets/"+t.id+"/name",{name:d}),await c("PUT","/api/secrets/"+t.id+"/hosts",{hosts:s}),n&&n.join()!==t.inject.join()&&await c("PUT","/api/secrets/"+t.id+"/inject",{inject:n}),a("se-sensitive").checked!==t.sensitive&&await c("PUT","/api/secrets/"+t.id+"/sensitive",{sensitive:a("se-sensitive").checked}),a("se-dialog").close(),await e.load()},o(),a("se-dialog").showModal()}m("ks-secrets",{template:ma,wire(){X(this);let e="key",t=s=>{e=s;let o=s==="login";a("s-pick-key").setAttribute("aria-checked",String(!o)),a("s-pick-key").classList.toggle("opacity-75",o),a("s-pick-login").setAttribute("aria-checked",String(o)),a("s-pick-login").classList.toggle("opacity-75",!o),a("s-panel-key").classList.toggle("hidden",o),a("s-panel-login").classList.toggle("hidden",!o)};h("s-pick-key",()=>t("key")),h("s-pick-login",()=>t("login")),this.openAdd=({name:s="",host:o=""}={})=>{t("key"),a("s-sensitive").checked=!0,s&&(a("s-name").value=s),o&&(a("s-hosts").value=o),a("s-dialog").showModal(),s?a("s-value").focus():a("s-name").focus()},h("s-open",()=>this.openAdd()),h("se-save",()=>a("se-dialog").onsave()),h("s-add",async()=>{let s=a("s-name").value.trim(),o=P(a("s-hosts").value),n=a("s-sensitive").checked;e==="login"?await c("POST","/api/secrets",{kind:"login",name:s,username:a("s-username").value.trim(),password:a("s-password").value,hosts:o,inject:[],sensitive:n}):await c("POST","/api/secrets",{kind:"key",name:s,value:a("s-value").value,hosts:o,inject:[],sensitive:n});for(let r of["s-name","s-value","s-username","s-password","s-hosts"])a(r).value="";a("s-value").type="password",a("s-password").type="password",a("s-dialog").close(),L(i("portal.secrets.saved")),await this.load()}),a("s-dialog").addEventListener("close",()=>{for(let s of["s-value","s-password","s-username"])a(s).value="";a("s-value").type="password",a("s-password").type="password"})},async load(){let[e,t,s]=await Promise.all([c("GET","/api/secrets"),c("GET","/api/grants"),c("GET","/api/blocks")]),o=r=>{let d=t.filter(l=>l.secretName===r.name),p=document.createDocumentFragment();return p.append(...d.length?d.map(l=>g(this,"grant",{tool:l.toolName,host:w(l.host),left:l.expiresAt?l.expiresAt>Date.now()?F(l.expiresAt-Date.now()):i("portal.grants.expired"):i("portal.duration.always")})):[g(this,"no-grants")]),g(this,"detail",{name:r.name,sensitive:r.sensitive,pause:R("secret-block-"+r.name,s,{kind:"secret",secretName:r.name},()=>this.load()),kindNote:i(r.kind==="login"?"portal.secrets.kindLoginNote":"portal.secrets.kindKeyNote"),host:w(r.hosts[0]??""),subdomains:r.hosts.slice(1).map(w).join(", "),grants:p,inject:r.inject?r.inject.length?r.inject.join(", "):i("portal.secrets.learning"):i("portal.secrets.legacyInject"),touch:i(r.sensitive?"portal.secrets.touchSensitive":"portal.secrets.touchGrant"),updated:i("portal.secrets.valueSet",{date:C(r.updatedAt)})},{edit:()=>so(this,r),rotate:async()=>{let l=await x(i("portal.secrets.rotatePrompt",{name:r.name}),{input:"password",ok:"portal.secrets.rotate",warning:i("portal.secrets.rotateWarning")});l&&(await c("POST","/api/secrets/"+r.id+"/rotate",{value:l}),await this.load())},revoke:async()=>{let l=d.length?i("portal.secrets.revokeGrants",{list:d.map(k=>k.toolName+" → "+r.name+" → "+w(k.host)).join("; ")}):"";await x(i("portal.secrets.revokeConfirm",{name:r.name}),{ok:"portal.secrets.revoke",warning:l})&&(await c("DELETE","/api/secrets/"+r.id),await this.load())}})},n=e.map(r=>({row:g(this,"row",{name:r.name,isKey:r.kind!=="login",isLogin:r.kind==="login",sensitive:r.sensitive,host:w(r.hosts[0]??""),grantCount:ao(t.filter(d=>d.secretName===r.name).length)}),item:r}));a("secrets-total").textContent=String(e.length),a("secrets-sensitive").textContent=String(e.filter(r=>r.sensitive).length),a("secrets-count").textContent=i("portal.keys.count",{count:e.length}),A(a("secrets"),a("secret-detail"),n,{keyOf:r=>r.id,render:o,empty:()=>g(this,"pick")}),n.length||a("secrets").replaceChildren(g(this,"empty"))}});var ha=`<div class="overflow-x-auto max-h-[300px] overflow-y-auto"><table class="table" data-testid="device-table">
  <thead><tr><th data-i18n="portal.common.tool"></th><th data-i18n="portal.device.client"></th><th class="hidden 2xl:table-cell" data-i18n="portal.device.since"></th><th></th></tr></thead>
  <tbody id="device"></tbody>
</table></div>
<p id="device-empty" class="opacity-60 hidden" data-testid="device-empty" data-i18n="portal.device.empty"></p>

<template data-template="row">
  <tr>
    <td><div class="flex flex-wrap gap-1"><span class="font-mono whitespace-nowrap" data-field="name"></span><span data-if="existing" data-if-not="pairable" class="badge badge-soft badge-warning" data-i18n="portal.device.exists"></span><span data-if="pairable" class="badge badge-soft badge-info" data-i18n="portal.device.rotated"></span></div></td>
    <td data-field="client"></td>
    <td class="hidden 2xl:table-cell" data-field="since"></td>
    <td><div class="flex flex-wrap gap-1">
      <button class="btn btn-xs btn-outline gap-1" data-action="approve" data-testid="device-approve-{name}"><svg class="size-3" aria-hidden="true"><use href="#i-touch"/></svg><span data-i18n="portal.device.approve"></span></button>
      <button class="btn btn-xs btn-primary" data-action="deny" data-testid="device-deny-{name}" data-i18n="portal.device.deny"></button>
    </div></td>
  </tr>
</template>
`;var no=e=>new Promise(t=>setTimeout(t,e));m("ks-device-list",{template:ha,async load(){let e=[];for(let t of await c("GET","/api/device"))e.push(g(this,"row",{name:t.clientName,existing:t.existing,pairable:t.pairable,client:t.client,since:C(t.since)},{approve:async()=>{let s=await x(i("portal.device.enterCode",{name:t.clientName}),{input:"text",ok:"portal.device.checkCode"});if(typeof s!="string"||!s.trim())return;await c("POST","/api/device/"+t.id+"/verify",{code:s});let o=await c("POST","/api/device/"+t.id+"/approve");if(o.touch&&!await Me(o.touch)){L(i("portal.device.noTouch"),"warning"),await this.load();return}for(let n=0;o.touch&&n<50&&(await c("GET","/api/device")).some(r=>r.id===t.id);n++)await no(100);L(i("portal.device.paired",{name:t.clientName}),"success"),this.dispatchEvent(new CustomEvent("tool-paired",{bubbles:!0,detail:{name:t.clientName}})),await this.load()},deny:async()=>{await c("POST","/api/device/"+t.id+"/deny"),await this.load()}}));a("device").replaceChildren(...e),ne("tools",e.length),a("device-empty").classList.toggle("hidden",e.length>0)}});var ka=`<div class="overflow-x-auto max-h-[300px] overflow-y-auto"><table class="table table-sm" data-testid="paired-tools">
  <thead><tr><th data-i18n="portal.common.tool"></th><th data-i18n="portal.keys.kind"></th><th data-i18n="portal.device.since"></th></tr></thead>
  <tbody id="paired-tools"></tbody>
</table></div>
<p id="paired-tools-empty" class="opacity-60 hidden" data-testid="paired-tools-empty" data-i18n="portal.device.pairedEmpty"></p>

<template data-template="row">
  <tr data-testid="paired-tool-{name}">
    <td class="font-mono" data-field="name"></td>
    <td data-field="kind"></td>
    <td data-field="since"></td>
  </tr>
</template>
`;var va={web:"portal.keys.kindWeb",mcp:"portal.keys.kindMcp"};m("ks-paired-tools",{template:ka,async load(){let e=(await c("GET","/api/tools")).filter(t=>!t.revoked);return a("paired-tools").replaceChildren(...e.map(t=>g(this,"row",{name:t.name,kind:i(va[t.kind]??va.web),since:C(t.createdAt)}))),a("paired-tools-empty").classList.toggle("hidden",e.length>0),e}});var fa=`<div class="space-y-3">
  <div id="pk-list" class="rows" data-testid="passkeys-table" data-i18n-aria-label="portal.passkeys.yours"></div>
  <div id="pk-recommend" class="note note-signal hidden" data-testid="pk-recommend">
    <svg aria-hidden="true"><use href="#i-phone"/></svg>
    <div class="flex-1"><p class="font-medium text-[var(--ink)]"><span data-i18n="portal.passkeys.another"></span> <span class="tag tag-signal ml-1" data-i18n="portal.passkeys.recommended"></span></p><p data-i18n="portal.passkeys.anotherHelp"></p></div>
  </div>
</div>

<!-- Een rij: in Authentication kies je ze (detail rechts), in het welkom is het een gewone lijst. -->
<template data-template="item">
  <div class="row" data-testid="passkey-row">
    <span class="row-icon"><svg aria-hidden="true"><use data-icon/></svg></span>
    <span class="min-w-0"><span class="row-title" data-field="title" data-testid="passkey-name"></span><span class="row-note" data-field="note"></span></span>
    <span data-if="prf" class="tag tag-signal" data-i18n="portal.passkeys.unlocks"></span><span data-if-not="prf" class="tag tag-warn" data-i18n="portal.passkeys.noPrf"></span>
  </div>
</template>
<template data-template="detail">
  <article class="detail">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 class="text-2xl" data-field="title"></h2>
        <p data-if="prf" class="reading-note" data-i18n="portal.passkeys.prfNote"></p>
        <p data-if-not="prf" class="reading-note" data-i18n="portal.passkeys.noPrfNote"></p>
      </div>
      <div class="flex-none" data-field="pause"></div>
    </div>
    <dl class="facts">
      <dt data-i18n="portal.keys.kind"></dt><dd data-field="kind"></dd>
      <dt data-i18n="portal.passkeys.vault"></dt><dd><span data-if="prf" class="tag tag-signal" data-i18n="portal.passkeys.unlocks"></span><span data-if-not="prf" class="tag tag-warn" data-i18n="portal.passkeys.noPrf"></span></dd>
      <dt data-i18n="portal.passkeys.added"></dt><dd class="mono" data-field="added"></dd>
      <dt data-if="used" data-i18n="portal.passkeys.used"></dt><dd data-if="used" class="mono" data-field="used"></dd>
    </dl>
    <div class="detail-actions">
      <button class="btn btn-sm btn-ghost text-[var(--bad)] gap-1" data-action="remove" data-testid="passkey-remove"><svg class="size-4" aria-hidden="true"><use href="#i-trash"/></svg><span data-i18n="portal.passkeys.remove"></span></button>
      <button class="btn btn-sm btn-outline gap-1" data-action="rename" data-testid="passkey-rename"><svg class="size-4" aria-hidden="true"><use href="#i-edit"/></svg><span data-i18n="portal.passkeys.rename"></span></button>
    </div>
  </article>
</template>
`;var ro=[["hybrid","phone","i-phone"],["internal","thisPc","i-laptop"],["usb","securityKey","i-key"],["nfc","securityKey","i-key"],["ble","securityKey","i-key"]],ya=e=>ro.find(([t])=>(e??[]).includes(t))??[null,"unknown","i-key"];m("ks-passkey-list",{template:fa,async load(){let e=T().vaultExists?await c("GET","/api/passkeys"):[],t=this.parentElement?.id==="passkeys-slot",s=t&&e.length>1?await c("GET","/api/blocks"):null,o=d=>{let[,p]=ya(d.transports),l=i("portal.passkeys.kind."+p);return{title:d.name||l,kind:l,prf:d.prf,label:l,used:d.lastUsedAt?C(d.lastUsedAt)+" "+N(d.lastUsedAt):""}},n=d=>{let p=o(d);return g(this,"detail",{...p,added:C(d.createdAt),pause:s?R("passkey-block",s,{kind:"passkey",passkeyId:d.id},()=>this.load()):""},{rename:async()=>{let l=await x(i("portal.passkeys.renamePrompt"),{input:"text",value:d.name,ok:"portal.keys.editSave"});l!==null&&(await c("PUT","/api/passkeys/"+d.id+"/name",{name:l}),await this.load())},remove:async()=>{await x(i("portal.passkeys.removeConfirm",{name:p.title}),{ok:"portal.passkeys.remove"})&&(await c("DELETE","/api/passkeys/"+d.id),this.dispatchEvent(new CustomEvent("passkeys-changed",{bubbles:!0})))}})},r=e.map(d=>{let p=o(d),l=g(this,"item",{...p,note:[p.label,p.used&&i("portal.passkeys.lastUsed",{date:p.used})].filter(Boolean).join(", ")});return l.querySelector("[data-icon]").setAttribute("href","#"+ya(d.transports)[2]),l.dataset.prf=String(d.prf),{row:l,item:d}});t?(a("pk-list").setAttribute("role","listbox"),A(a("pk-list"),a("pk-detail"),r,{keyOf:d=>d.id,render:n})):(a("pk-list").removeAttribute("role"),a("pk-list").replaceChildren(...r.map(d=>d.row))),a("pk-list").classList.toggle("hidden",e.length===0),a("pk-recommend").classList.toggle("hidden",e.length!==1),this.dataset.count=String(e.length),this.dataset.opens=String(e.filter(d=>d.prf).length)}});var ba=`<div class="space-y-2">
  <p class="font-semibold text-sm" data-i18n="portal.passkeys.add"></p>
  <button id="pk-add-external" class="btn btn-block justify-start gap-3 h-auto py-3" data-testid="pk-add-external"><svg class="size-6 text-primary" aria-hidden="true"><use href="#i-key"/></svg><span class="text-left"><span class="block" data-i18n="portal.passkeys.securityKey"></span><span class="block text-xs opacity-60 font-normal" data-i18n="portal.passkeys.securityKeyHelp"></span></span></button>
  <button id="pk-add-phone" class="btn btn-block justify-start gap-3 h-auto py-3" data-testid="pk-add-phone"><svg class="size-6 text-primary" aria-hidden="true"><use href="#i-phone"/></svg><span class="text-left"><span class="block" data-i18n="portal.passkeys.phone"></span><span class="block text-xs opacity-60 font-normal" data-i18n="portal.passkeys.phoneHelp"></span></span></button>
  <button id="pk-add" class="btn btn-block justify-start gap-3 h-auto py-3" data-testid="pk-add"><svg class="size-6 text-primary" aria-hidden="true"><use href="#i-laptop"/></svg><span class="text-left"><span class="block" data-i18n="portal.passkeys.thisPc"></span><span class="block text-xs opacity-60 font-normal" data-i18n="portal.passkeys.thisPcHelp"></span></span></button>
</div>
`;m("ks-passkey-add",{template:ba,wire(){let e=t=>async()=>{await He(t,{first:!T().vaultExists}),this.dispatchEvent(new CustomEvent("passkeys-changed",{bubbles:!0}))};M({"pk-add-external":e("security-key"),"pk-add-phone":e("phone"),"pk-add":e("platform")})}});var wa=`<div class="work-head flex-wrap">
  <div class="min-w-0">
    <h1 class="screen-title" data-i18n="portal.tabs.passkeys"></h1>
    <p class="max-w-[68ch]" data-i18n="portal.passkeys.intro"></p>
  </div>
  <div class="flex items-center gap-6">
    <div class="figures">
      <span class="figure"><b id="pk-opens" data-testid="pk-opens">0</b><span data-i18n="portal.passkeys.figOpens"></span></span>
      <span class="figure"><b id="pk-signs" data-testid="pk-signs">0</b><span data-i18n="portal.passkeys.figSigns"></span></span>
    </div>
    <button id="pk-open" class="btn btn-primary btn-sm gap-1.5" data-testid="pk-open"><svg class="size-4" aria-hidden="true"><use href="#i-plus"/></svg><span data-i18n="portal.passkeys.addTitle"></span></button>
  </div>
</div>
<div id="pk-summary" class="note hidden" data-testid="pk-summary"><svg aria-hidden="true"><use href="#i-key"/></svg><span id="pk-summary-text"></span></div>
<div class="split h-[calc(100vh-17rem)] min-h-[420px]">
  <section class="panel" aria-labelledby="pk-head">
    <div class="panel-head"><h2 id="pk-head" data-i18n="portal.passkeys.yours"></h2><span id="pk-count"></span></div>
    <div id="passkeys-slot" class="panel-body"></div>
    <p class="panel-foot muted" data-i18n="portal.passkeys.nothingToKeep"></p>
  </section>
  <section id="pk-detail" class="panel" data-testid="passkey-detail" data-i18n-aria-label="portal.tabs.passkeys"></section>
</div>

<dialog id="pk-dialog" class="modal" data-testid="pk-dialog" aria-labelledby="pk-dialog-title">
  <div class="modal-box max-w-lg">
    <form method="dialog"><button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" data-i18n-aria-label="portal.keys.close"><svg class="size-4" aria-hidden="true"><use href="#i-x"/></svg></button></form>
    <h3 id="pk-dialog-title" class="font-bold text-xl flex items-center gap-2 pr-8"><svg class="size-5 text-primary" aria-hidden="true"><use href="#i-plus"/></svg><span data-i18n="portal.passkeys.addTitle"></span></h3>
    <div id="pk-add-slot" class="mt-3"></div>
    <div class="modal-action"><form method="dialog"><button class="btn btn-ghost" data-i18n="portal.ask.cancel"></button></form></div>
  </div>
  <form method="dialog" class="modal-backdrop"><button tabindex="-1" data-i18n="portal.keys.close"></button></form>
</dialog>
`;m("ks-passkeys",{template:wa,wire(){h("pk-open",()=>{j("ks-passkey-add",a("pk-add-slot")),a("pk-dialog").showModal()}),this.addEventListener("passkeys-changed",()=>{a("pk-dialog").close(),v(f)})},async load(){let e=j("ks-passkey-list",a("passkeys-slot"));await e.load();let t=Number(e.dataset.count),s=Number(e.dataset.opens);a("pk-opens").textContent=String(s),a("pk-signs").textContent=String(t-s),a("pk-count").textContent=i("portal.keys.count",{count:t}),a("pk-summary").classList.toggle("hidden",t===0),a("pk-summary-text").textContent=i(s===1?"portal.passkeys.opensOne":"portal.passkeys.opens",{count:s})+(t>s?" "+i("portal.passkeys.signInOnly",{count:t-s}):"")}});var xa=`<div class="work-head flex-wrap">
  <div class="min-w-0">
    <h1 class="screen-title" data-i18n="portal.settings.title"></h1>
    <p class="max-w-[68ch]" data-i18n="portal.settings.intro"></p>
  </div>
  <span class="flex items-center gap-1.5 text-sm muted"><svg class="size-4 text-[var(--ok)]" aria-hidden="true"><use href="#i-check"/></svg><span data-i18n="portal.settings.auto"></span></span>
</div>
<div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
  <div class="flex flex-col gap-4">
    <section class="panel" aria-labelledby="set-g-vault">
      <div class="panel-head"><h2 id="set-g-vault" data-i18n="portal.settings.groupVault"></h2></div>
      <div class="rows">
        <div class="flex items-center gap-4 px-4 py-3"><div class="min-w-0 flex-1"><p class="font-medium"><label for="set-autolock" data-i18n="portal.settings.autolock"></label></p><p class="text-sm muted" data-i18n="portal.settings.autolockHelp"></p></div>
          <select id="set-autolock" class="select select-sm w-44" data-testid="set-autolock"><option value="5" translate="no">5 min</option><option value="15" translate="no">15 min</option><option value="60" translate="no">60 min</option></select></div>
        <div class="flex items-center gap-4 px-4 py-3"><div class="min-w-0 flex-1"><p class="font-medium"><label for="set-timeout" data-i18n="portal.settings.timeout"></label></p><p class="text-sm muted" data-i18n="portal.settings.timeoutHelp"></p></div>
          <select id="set-timeout" class="select select-sm w-44" data-testid="set-timeout"><option value="15" translate="no">15 s</option><option value="30" translate="no">30 s</option><option value="60" translate="no">60 s</option></select></div>
        <div class="flex items-center gap-4 px-4 py-3"><div class="min-w-0 flex-1"><p class="font-medium"><label for="set-touch" data-i18n="portal.settings.touch"></label></p><p class="text-sm muted" data-i18n="portal.settings.touchHelp"></p></div>
          <select id="set-touch" class="select select-sm w-44" data-testid="set-touch"><option value="any" data-i18n="portal.settings.touchAny"></option><option value="external" data-i18n="portal.settings.touchExternal"></option></select></div>
      </div>
    </section>
    <section class="panel" aria-labelledby="set-g-look">
      <div class="panel-head"><h2 id="set-g-look" data-i18n="portal.settings.groupLook"></h2></div>
      <div class="rows">
        <div class="flex items-center gap-4 px-4 py-3"><div class="min-w-0 flex-1"><p class="font-medium"><label for="set-language" data-i18n="portal.settings.language"></label></p><p class="text-sm muted" data-i18n="portal.settings.languageHelp"></p></div>
          <select id="set-language" class="select select-sm w-44" data-testid="set-language"><option value="" data-i18n="portal.settings.languageSystem"></option><option value="en" translate="no">English</option><option value="nl" translate="no">Nederlands</option></select></div>
        <div class="flex items-center gap-4 px-4 py-3"><div class="min-w-0 flex-1"><p class="font-medium"><label for="set-theme" data-i18n="portal.settings.theme"></label></p><p class="text-sm muted" data-i18n="portal.settings.themeHelp"></p></div>
          <select id="set-theme" class="select select-sm w-44" data-testid="set-theme"><option value="" data-i18n="portal.settings.themeSystem"></option><option value="dracula" data-i18n="portal.settings.themeDark"></option><option value="console-light" data-i18n="portal.settings.themeLight"></option></select></div>
      </div>
    </section>
  </div>
  <div class="flex flex-col gap-4">
    <section class="panel" aria-labelledby="set-g-net">
      <div class="panel-head"><h2 id="set-g-net" data-i18n="portal.settings.groupNetwork"></h2></div>
      <div class="rows">
        <div class="flex items-center gap-4 px-4 py-3"><div class="min-w-0 flex-1"><p class="font-medium" data-i18n="portal.settings.listeners"></p><p id="set-listeners-now" class="text-sm muted" data-testid="set-listeners-now"></p></div>
          <button id="set-listeners-open" class="btn btn-sm btn-outline gap-1" data-testid="set-listeners-open"><svg class="size-4" aria-hidden="true"><use href="#i-edit"/></svg><span data-i18n="portal.keys.edit"></span></button></div>
        <div class="flex items-center gap-4 px-4 py-3"><div class="min-w-0 flex-1"><p class="font-medium" data-i18n="portal.settings.routes"></p><p id="set-routes-now" class="text-sm muted" data-testid="set-routes-now"></p></div>
          <button id="set-routes-open" class="btn btn-sm btn-outline gap-1" data-testid="set-routes-open"><svg class="size-4" aria-hidden="true"><use href="#i-edit"/></svg><span data-i18n="portal.keys.edit"></span></button></div>
      </div>
    </section>
    <section class="panel" aria-labelledby="set-g-quiet">
      <div class="panel-head"><h2 id="set-g-quiet" data-i18n="portal.settings.groupQuiet"></h2></div>
      <div class="rows">
        <div class="flex items-center gap-4 px-4 py-3"><div class="min-w-0 flex-1"><p class="font-medium" data-i18n="portal.settings.quietHours"></p><p class="text-sm muted"><span data-i18n="portal.settings.quietHoursHelp"></span>: <span id="set-quiet-now" class="mono" data-testid="set-quiet-now"></span></p></div>
          <button id="set-quiet-open" class="btn btn-sm btn-outline gap-1" data-testid="set-quiet-open"><svg class="size-4" aria-hidden="true"><use href="#i-edit"/></svg><span data-i18n="portal.keys.edit"></span></button></div>
        <div class="flex items-center gap-4 px-4 py-3"><div class="min-w-0 flex-1"><p class="font-medium" data-i18n="portal.settings.notifications"></p><p class="text-sm muted" data-i18n="portal.settings.notificationsHelp"></p></div>
          <span id="set-silence" class="contents"></span></div>
      </div>
    </section>
    <section class="panel" aria-labelledby="set-g-security">
      <div class="panel-head"><h2 id="set-g-security" data-i18n="portal.specs.title"></h2></div>
      <div class="flex items-center gap-4 px-4 py-3"><p class="min-w-0 flex-1 text-sm muted" data-i18n="portal.specs.help"></p><ks-security-specs></ks-security-specs></div>
    </section>
    <section class="panel border-error/30" aria-labelledby="set-g-danger">
      <div class="panel-head"><h2 id="set-g-danger" class="text-error" data-i18n="portal.settings.groupDanger"></h2></div>
      <div class="flex items-center gap-4 px-4 py-3"><div class="min-w-0 flex-1"><p class="font-medium text-error" data-i18n="portal.settings.deleteVault"></p><p class="text-sm muted" data-i18n="portal.settings.deleteVaultHelp"></p></div>
        <button id="set-delete-vault" type="button" class="btn btn-sm btn-error btn-outline gap-1" data-testid="set-delete-vault"><svg class="size-4 shrink-0" aria-hidden="true"><use href="#i-touch"/></svg><span data-i18n="portal.settings.deleteVault"></span></button></div>
    </section>
  </div>
</div>

<dialog id="set-listeners-dialog" class="modal" aria-labelledby="set-listeners-title">
  <div class="modal-box max-w-lg">
    <form method="dialog"><button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" data-i18n-aria-label="portal.keys.close"><svg class="size-4" aria-hidden="true"><use href="#i-x"/></svg></button></form>
    <h3 id="set-listeners-title" class="font-bold text-xl flex items-center gap-2 pr-8"><svg class="size-5 text-primary" aria-hidden="true"><use href="#i-globe"/></svg><span data-i18n="portal.settings.listeners"></span></h3>
    <p class="text-sm opacity-75 mt-1" data-i18n="portal.settings.listenersIntro"></p>
    <div role="alert" class="alert alert-soft alert-warning text-xs mt-3"><svg class="size-4 shrink-0" aria-hidden="true"><use href="#i-warn"/></svg><span data-i18n="portal.settings.listenersWarning"></span></div>
    <fieldset class="fieldset mt-3"><label class="label" for="set-listeners" data-i18n="portal.settings.listenersLabel"></label><textarea id="set-listeners" rows="3" class="textarea w-full font-mono" placeholder="192.168.1.50:8484" data-testid="set-listeners"></textarea><p class="label text-xs whitespace-normal" data-i18n="portal.settings.listenersHelp"></p></fieldset>
    <div class="modal-action">
      <form method="dialog"><button class="btn btn-ghost" data-i18n="portal.ask.cancel"></button></form>
      <button type="button" id="set-listeners-save" class="btn btn-primary" data-testid="set-listeners-save" data-i18n="portal.keys.editSave"></button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop"><button tabindex="-1" data-i18n="portal.keys.close"></button></form>
</dialog>

<dialog id="set-quiet-dialog" class="modal" aria-labelledby="set-quiet-title">
  <div class="modal-box max-w-lg">
    <form method="dialog"><button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" data-i18n-aria-label="portal.keys.close"><svg class="size-4" aria-hidden="true"><use href="#i-x"/></svg></button></form>
    <h3 id="set-quiet-title" class="font-bold text-xl flex items-center gap-2 pr-8"><svg class="size-5 text-primary" aria-hidden="true"><use href="#i-clock"/></svg><span data-i18n="portal.settings.quietHours"></span></h3>
    <p class="text-sm opacity-75 mt-1" data-i18n="portal.settings.quietIntro"></p>
    <fieldset class="fieldset mt-3"><label class="label" for="set-quiet" data-i18n="portal.settings.quietLabel"></label><textarea id="set-quiet" rows="3" class="textarea w-full font-mono" placeholder="23:00-07:00" data-testid="set-quiet"></textarea><p class="label text-xs whitespace-normal" data-i18n="portal.settings.quietHelp"></p></fieldset>
    <div class="modal-action">
      <form method="dialog"><button class="btn btn-ghost" data-i18n="portal.ask.cancel"></button></form>
      <button type="button" id="set-quiet-save" class="btn btn-primary" data-testid="set-quiet-save" data-i18n="portal.keys.editSave"></button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop"><button tabindex="-1" data-i18n="portal.keys.close"></button></form>
</dialog>

<dialog id="set-routes-dialog" class="modal" aria-labelledby="set-routes-title">
  <div class="modal-box max-w-3xl">
    <form method="dialog"><button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3" data-i18n-aria-label="portal.keys.close"><svg class="size-4" aria-hidden="true"><use href="#i-x"/></svg></button></form>
    <h3 id="set-routes-title" class="font-bold text-xl pr-8" data-i18n="portal.settings.routes"></h3>
    <p class="text-sm opacity-75 mt-1" data-i18n="portal.settings.routesIntro"></p>
    <div id="set-routes" class="space-y-2 mt-3" data-testid="set-routes"></div>
    <button type="button" id="set-route-add" class="btn btn-sm btn-ghost gap-1 mt-2" data-testid="set-route-add"><svg class="size-4" aria-hidden="true"><use href="#i-plus"/></svg><span data-i18n="portal.settings.routeAdd"></span></button>
    <div class="modal-action">
      <form method="dialog"><button class="btn btn-ghost" data-i18n="portal.ask.cancel"></button></form>
      <button type="button" id="set-routes-save" class="btn btn-primary" data-testid="set-routes-save" data-i18n="portal.keys.editSave"></button>
    </div>
  </div>
  <form method="dialog" class="modal-backdrop"><button tabindex="-1" data-i18n="portal.keys.close"></button></form>
</dialog>

<template data-template="route">
  <div class="grid grid-cols-[1fr_2fr_1fr_1fr_auto] gap-2 items-center" data-route>
    <input class="input input-sm font-mono" data-part="name" placeholder="litellm" data-i18n-aria-label="portal.settings.routeName">
    <input class="input input-sm font-mono" data-part="base" placeholder="http://127.0.0.1:4000" data-i18n-aria-label="portal.settings.routeBase">
    <input class="input input-sm font-mono" data-part="secret" placeholder="litellm" data-i18n-aria-label="portal.common.secret">
    <select class="select select-sm" data-part="header" data-i18n-aria-label="portal.settings.routeHeader"><option value="authorization" translate="no">Authorization</option><option value="x-api-key" translate="no">x-api-key</option><option value="x-goog-api-key" translate="no">x-goog-api-key</option><option value="basic" translate="no">Basic</option></select>
    <button type="button" class="btn btn-sm btn-ghost text-error" data-action="remove" data-i18n-aria-label="portal.grants.revoke"><svg class="size-4" aria-hidden="true"><use href="#i-trash"/></svg></button>
  </div>
</template>
`;var go=()=>{try{return localStorage.getItem("vaultgate.lang")??""}catch{return""}};function Ta(e,t,s){[...e.options].some(o=>o.value===String(t))||e.append(new Option(`${t} ${s}`,String(t))),e.value=String(t)}async function Se(e,t){await c("PUT","/api/settings",t),await se(),L(i("portal.settings.saved"),"success"),await e.load()}function ja(e,t={name:"",base:"",secret:"",header:"authorization"}){let s=g(e,"route",{},{remove:()=>s.remove()});for(let o of["name","base","secret","header"])s.querySelector(`[data-part="${o}"]`).value=t[o];return s}m("ks-settings",{template:xa,wire(){a("set-language").addEventListener("change",()=>v(()=>(Pe(a("set-language").value),f()))),a("set-theme").addEventListener("change",()=>Ke(a("set-theme").value));let e=(t,s)=>a(t).addEventListener("change",()=>v(()=>Se(this,s())));e("set-autolock",()=>({autoLockMs:Number(a("set-autolock").value)*6e4})),e("set-timeout",()=>({approvalTimeoutMs:Number(a("set-timeout").value)*1e3})),e("set-touch",()=>({touchAuthenticator:a("set-touch").value})),a("set-listeners-open").addEventListener("click",()=>a("set-listeners-dialog").showModal()),a("set-routes-open").addEventListener("click",()=>a("set-routes-dialog").showModal()),a("set-quiet-open").addEventListener("click",()=>a("set-quiet-dialog").showModal()),a("set-route-add").addEventListener("click",()=>a("set-routes").append(ja(this))),a("set-listeners-save").addEventListener("click",()=>v(async()=>{let t=P(a("set-listeners").value).map(s=>{let o=s.lastIndexOf(":");return{host:s.slice(0,o),port:Number(s.slice(o+1))}});await Se(this,{listeners:t}),a("set-listeners-dialog").close()})),a("set-quiet-save").addEventListener("click",()=>v(async()=>{await Se(this,{quietHours:P(a("set-quiet").value)}),a("set-quiet-dialog").close()})),a("set-routes-save").addEventListener("click",()=>v(async()=>{let t=[...a("set-routes").querySelectorAll("[data-route]")].map(s=>Object.fromEntries(["name","base","secret","header"].map(o=>[o,s.querySelector(`[data-part="${o}"]`).value.trim()])));await Se(this,{routes:t}),a("set-routes-dialog").close()})),a("set-delete-vault").addEventListener("click",()=>v(async()=>{await x(i("portal.settings.deleteVaultConfirm"),{ok:"portal.settings.deleteVault",warning:i("portal.settings.deleteVaultWarning")})&&(await c("POST","/api/vault/delete"),$(),L(i("portal.settings.vaultDeleted"),"success"),await f())}))},async load(){a("set-language").value=go(),a("set-theme").value=me();let e=await c("GET","/api/settings");Ta(a("set-autolock"),e.autoLockMs/6e4,"min"),Ta(a("set-timeout"),e.approvalTimeoutMs/1e3,"s"),a("set-touch").value=e.touchAuthenticator,a("set-listeners").value=e.listeners.map(t=>t.host+":"+t.port).join(`
`),a("set-listeners-now").textContent=e.listeners.length?e.listeners.map(t=>t.host+":"+t.port).join(", "):i("portal.settings.listenersNone"),a("set-quiet").value=e.quietHours.join(`
`),a("set-quiet-now").textContent=e.quietHours.length?e.quietHours.join(", "):i("portal.settings.quietNone"),a("set-silence").replaceChildren(oe({id:"set-silence",kind:"silence",until:e.notificationSnooze?.globalUntil??void 0,pause:async t=>{await c("POST","/api/snooze/global",{until:t}),await this.load()},resume:async()=>{await c("POST","/api/snooze/global",{until:null}),await this.load()}})),a("set-routes").replaceChildren(...e.routes.map(t=>ja(this,t))),a("set-routes-now").textContent=e.routes.length?e.routes.map(t=>"/"+t.name+" → "+t.base).join(", "):i("portal.settings.routesNone")}});var Sa=`<a class="inline-flex items-center gap-1.5 text-sm underline decoration-[var(--line-2)] underline-offset-4 hover:decoration-[var(--signal)]" href="https://vaultgate.github.io/Vaultgate/security.html#keys" target="_blank" rel="noopener noreferrer" data-testid="security-specs"><svg class="size-4" aria-hidden="true"><use href="#i-shield"/></svg><span data-i18n="portal.specs.link"></span></a>
`;m("ks-security-specs",{template:Sa});O(document.body);a("window-warning").classList.toggle("hidden",matchMedia("(display-mode: standalone)").matches);v(f);var Ca=!1;document.addEventListener("vault-state",({detail:e})=>{e.kind!=="open"||Ca||(Ca=!0,be({auto:!0}).catch(()=>{}))});})();
