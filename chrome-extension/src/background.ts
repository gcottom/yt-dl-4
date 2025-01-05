const goPort = 50999;

//////////////////////
// START HIGHLANDER //
//////////////////////
const INTERNAL_TESTALIVE_PORT = "DNA_Internal_alive_test";

//const startSeconds = 1;
const nextSeconds = 25;
const SECONDS = 1000;
const DEBUG = false;

var alivePort: chrome.runtime.Port | null = null;
var isFirstStart = true;
var isAlreadyAwake = false;
//var timer = startSeconds*SECONDS;
var timer: number;
var firstCall: number;
var lastCall: number;

var wakeup: NodeJS.Timeout | undefined = undefined;
var wsTest = undefined;
var wCounter = 0;

const starter = `-------- >>> ${convertNoDate(Date.now())} UTC - Service Worker with HIGHLANDER DNA is starting <<< --------`;

console.log(starter);

// Start Highlander
letsStart();

// ----------------------------------------------------------------------------------------
function letsStart() {
    if (wakeup === undefined) {
        isFirstStart = true;
        isAlreadyAwake = true;
        firstCall = Date.now();
        lastCall = firstCall;
        //timer = startSeconds*SECONDS;
        timer = 300;

        wakeup = setInterval(Highlander, timer);
        console.log(`-------- >>> Highlander has been started at ${convertNoDate(firstCall)}`);
    }
}
// ----------------------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(
    async () => await initialize()
);

chrome.tabs.onCreated.addListener(onCreatedTabListener);
chrome.tabs.onUpdated.addListener(onUpdatedTabListener);
chrome.tabs.onRemoved.addListener(onRemovedTabListener);

// Clears the Highlander interval when browser closes.
// This allows the process associated with the extension to be removed.
// Normally the process associated with the extension once the host browser is closed 
// will be removed after about 30 seconds at maximum (from Chromium 110 up, before was 5 minutes).
// If the browser is reopened before the system has removed the (pending) process, 
// Highlander will be restarted in the same process which will be not removed anymore.
chrome.windows.onRemoved.addListener((windowId) => {
    wCounter--;
    if (wCounter > 0) {
        return;
    }

    // Browser is closing: no more windows open. Clear Highlander interval (or leave it active forever).
    // Shutting down Highlander will allow the system to remove the pending process associated with
    // the extension in max. 30 seconds (from Chromium 110 up, before was 5 minutes).
    if (wakeup !== undefined) {
        // If browser will be open before the process associated to this extension is removed, 
        // setting this to false will allow a new call to letsStart() if needed 
        // ( see windows.onCreated listener )
        isAlreadyAwake = false;

        // if you don't need to maintain the service worker running after the browser has been closed,
        // just uncomment the "# shutdown Highlander" rows below (already uncommented by default)
        console.log("Shutting down Highlander"); // # shutdown Highlander
        clearInterval(wakeup);                      // # shutdown Highlander
        wakeup = undefined;                         // # shutdown Highlander   
    }
});

chrome.windows.onCreated.addListener(async (window) => {
    let w = await chrome.windows.getAll();
    wCounter = w.length;
    if (wCounter == 1) {
        updateJobs();
    }
});

async function updateJobs() {
    if (isAlreadyAwake == false) {
        letsStart();
    }
}

async function checkTabs() {
    let results = await chrome.tabs.query({});
    results.forEach(onCreatedTabListener);
}

function onCreatedTabListener(tab: chrome.tabs.Tab): void {
    if (DEBUG) console.log("Created TAB id=", tab.id);
}

function onUpdatedTabListener(tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab): void {
    if (DEBUG) console.log("Updated TAB id=", tabId);
}

function onRemovedTabListener(tabId: number): void {
    if (DEBUG) console.log("Removed TAB id=", tabId);
}

// ---------------------------
// HIGHLANDER
// ---------------------------
async function Highlander() {

    const now = Date.now();
    const age = now - firstCall;
    lastCall = now;

    const str = `HIGHLANDER ------< ROUND >------ Time elapsed from first start: ${convertNoDate(age)}`;
    console.log(str)

    if (alivePort == null) {
        alivePort = chrome.runtime.connect({ name: INTERNAL_TESTALIVE_PORT })

        alivePort.onDisconnect.addListener((p) => {
            if (chrome.runtime.lastError) {
                if (DEBUG) console.log(`(DEBUG Highlander) Expected disconnect error. ServiceWorker status should be still RUNNING.`);
            } else {
                if (DEBUG) console.log(`(DEBUG Highlander): port disconnected`);
            }

            alivePort = null;
        });
    }

    if (alivePort) {

        alivePort.postMessage({ content: "ping" });

        if (chrome.runtime.lastError) {
            if (DEBUG) console.log(`(DEBUG Highlander): postMessage error: ${chrome.runtime.lastError.message}`)
        } else {
            if (DEBUG) console.log(`(DEBUG Highlander): "ping" sent through ${alivePort.name} port`)
        }
    }

    if (isFirstStart) {
        isFirstStart = false;
        setTimeout(() => {
            nextRound();
        }, 100);
    }

}

function convertNoDate(long: number): string {
    var dt = new Date(long).toISOString()
    return dt.slice(-13, -5) // HH:MM:SS only
}

function nextRound() {
    clearInterval(wakeup);
    timer = nextSeconds * SECONDS;
    wakeup = setInterval(Highlander, timer);
}

async function initialize() {
    await checkTabs();
    updateJobs();
}
// ------------------------------------------------------------------------------------
////////////////////
// END HIGHLANDER //
////////////////////

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.ytlink) {
        if (message.name) {
            getTrack(message.ytlink, message.name);
        } else {
            getTrack(message.ytlink)
        }
    } else if (message.rules) {
        initRules()
    } else if (message.acknowledge) {
        acknowledgeWarningRequest(message.acknowledge).then(() => {
            pollDownloadStatus(message.acknowledge)
        })
    }
});

function initRules() {
    const RULE = {
        id: 1,
        condition: {
            initiatorDomains: [chrome.runtime.id],
            requestDomains: ['music.youtube.com'],
            resourceTypes: [chrome.declarativeNetRequest.ResourceType.MAIN_FRAME, chrome.declarativeNetRequest.ResourceType.SUB_FRAME],
        },
        action: {
            type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
            responseHeaders: [
                { header: 'X-Frame-Options', operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
                { header: 'Frame-Options', operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
                { header: 'Content-Security-Policy', operation: chrome.declarativeNetRequest.HeaderOperation.REMOVE },
                { header: 'User-Agent', operation: chrome.declarativeNetRequest.HeaderOperation.SET, value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" },
            ],
        },
    };
    chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [RULE.id],
        addRules: [RULE],
    });
}

async function downloadTrack(ytlink: string): Promise<GetTrackResponse> {
    try {
        const response = await fetch(`http://localhost:${goPort}/download?id=${sanitizeUrl(ytlink)}`, {
            mode: "cors"
        });

        if (!response.ok) {
            throw new Error('Failed to fetch track data');
        }

        return await response.json();
    } catch (error) {
        console.error('Failed to fetch track data:', error);
        throw error;
    }
}
async function getTrack(link: string, fn?: string) {
    console.log("sending download track request for: " + link)
    if (fn == null || fn == undefined || fn == "") {
        fn = ""
    }
    downloadTrack(link).then(() => {
        var ytlink = sanitizeUrl(link)
        console.log("polling download status");
        pollDownloadStatus(ytlink)
    })
}

async function closemessage(id: string, artist: string, title: string) {
    try {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const activeTab = tabs[0]; // Access the first tab directly

        if (activeTab?.id) {
            chrome.tabs.sendMessage(activeTab.id, { complete: true, id: id, artist: artist, title: title });
            // Handle the response here
        } else {
            console.error("No active tabs found");
        }
    } catch (error) {
        console.error("Error:", error);
    }
}

async function sendErrorMessage(id: string) {
    try {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const activeTab = tabs[0]; // Access the first tab directly

        if (activeTab?.id) {
            chrome.tabs.sendMessage(activeTab.id, { error: true, id: id });
            // Handle the response here
        } else {
            console.error("No active tabs found");
        }
    } catch (error) {
        console.error("Error:", error);
    }
}

async function sendWarningMessage(id: string, warning: string) {
    try {
        const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const activeTab = tabs[0]; // Access the first tab directly

        if (activeTab?.id) {
            chrome.tabs.sendMessage(activeTab.id, { warning: warning, id: id });
            // Handle the response here
        } else {
            console.error("No active tabs found");
        }
    } catch (error) {
        console.error("Error:", error);
    }
}

async function acknowledgeWarningRequest(id: string): Promise<GetTrackResponse> {
    try {
        const response = await fetch(`http://localhost:${goPort}/acknowledge?id=${id}`, {
            mode: "cors"
        });
        if (!response.ok) {
            throw new Error('Failed to acknowledge warning');
        }
        return await response.json();
    } catch (error) {
        throw error;
    }
}

function updatePopup(id: string, state: string) {
    getFromDB(function (db) {
        var n = db.get(id)
        if (n != null && n != undefined) {
            n.state = "dl_done"
            db.set(id, n)
            chrome.storage.local.set({ "downloaddb": Object.fromEntries(db) })
        }
    })
}

async function pollDownloadStatus(id: string, st?: number): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
        const startTime = st === undefined ? new Date().getTime() : st;
        const pollInterval = st === undefined ? 5000 : 4000; // 4 seconds interval for polling

        // Create an interval for polling
        const poller = setInterval(async () => {
            const currentTime = new Date().getTime();

            // Check if the timeout has been reached
            if (currentTime > startTime + 1200000) { // 15 minutes timeout
                clearInterval(poller); // Clear the interval on timeout
                resolve(false); // Timeout reached, track not converted
                return;
            }

            try {
                const gic = await getStatus(id);
                if (gic.status === "complete") {
                    updatePopup(id, "dl_done")
                    closemessage(id, gic.track_artist, gic.track_title)
                    clearInterval(poller); // Clear the interval on completion
                    resolve(true); // Track is converted
                } else if (gic.status === "failed") {
                    updatePopup(id, "dl_error")
                    sendErrorMessage(id)
                    clearInterval(poller); // Clear the interval on error
                    resolve(false); // Error occurred
                } else if (gic.status === "warning") {
                    sendWarningMessage(id, gic.warning)
                    resolve(false)
                }
            } catch (error) {
                console.error('Polling error:', error);
            }
        }, pollInterval);
    });
}


async function getStatus(ytlink: string): Promise<DLStatusTrack> {
    try {
        const response = await fetch(`http://localhost:${goPort}/status?id=${ytlink}`, {
            mode: "cors"
        })
        if (!response.ok) {
            throw new Error('Failed to get download status');
        }
        return await response.json();
    } catch (error) {
        console.error('Failed to get get download status:', error)
        return {
            id: "",
            status: "",
            playlist_track_count: 0,
            playlist_track_done: 0,
            warning: "",
            track_artist: "",
            track_title: ""
        };
    }
}

function sanitizeUrl(ytlink: string): string {
    const reg = new RegExp('https://|www.|music.youtube.com/|youtube.com/|youtu.be/|watch\\?v=|&feature=share|playlist\\?list=', 'g');
    return ytlink.replace(reg, "").split("&")[0];
}


function getFromDB(callback: (db: Map<string, YTDetails>) => void) {
    chrome.storage.local.get("downloaddb", function (result) {
        const downloaddb = result.downloaddb;
        if (downloaddb) {
            const db = new Map<string, YTDetails>(Object.entries(downloaddb));
            callback(db);
        } else {
            const db = new Map<string, YTDetails>();
            callback(db);
        }
    });
}
