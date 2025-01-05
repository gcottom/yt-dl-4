interface GetTrackResponse {
    status: string
}

interface DLStatusTrack {
    id: string,
    status: string,
    playlist_track_count: number,
    playlist_track_done: number,
    warning: string,
    track_artist: string,
    track_title: string
}

interface DLDetailsTrack {
    downloaded: boolean,
    converted: boolean,
    genred: boolean,
    metaFetched: boolean,
    metaApplied: boolean
}

interface YTDetails {
    link: string
    name: string
    state: string
}

interface AlbumLinkDetails {
    id: string,
    name: string,
    link: string
}

interface DismissibleElement extends HTMLElement {
    remove(): void;
}

var bearer = "";


setInterval(checkLinks, 500);
setInterval(processRequestQueue, 10)
setInterval(nowPlayingChecker, 5000)

function checkLinks() {
    chrome.runtime.sendMessage({ rules: true });
    shareLinkChecker()
    listChecker()
    playlistChecker()
    if (reqList.length < 8) {
        gridAlbumLinkChecker()
        homePageAlbumLinkChecker()

    }

}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.complete && message.id) {
        if (message.artist && message.title) {
            startloader("success", "Download Completed Successfully! " + message.artist + " - " + message.title + ", ID: " + message.id)
        } else {
            startloader("success", "Download Completed Successfully! ID: " + message.id)
        }
    } else if (message.error && message.id) {
        startloader("error", "Download Error Occurred! ID: " + message.id)
    } else if (message.warning && message.id) {
        triggerWarning("Warning: " + message.warning + " ID: " + message.id, message.id)
    }
});

async function xhr(url: string): Promise<string> {
    return new Promise(res => {
        fetch(url)
            .then(
                response => response.text() // .json(), .blob(), etc.
            ).then(
                text => {
                    console.log(text)
                    var regex = RegExp('script.*try {const initialData.*</script>', 'g')
                    let t = text.match(regex)
                    if (t) {
                        var j = RegExp(/playlistId\\x22:\\x22(.+?)\\x22/, 'g')
                        var r = t[0].match(j)
                        if (r) {
                            var ir = RegExp(/playlistId\\x22:\\x22/)
                            var m: string[] = []
                            r.forEach(i => {
                                m.push(i.replace(ir, ""))
                            })
                            var d = new Map<string, number>()
                            m.forEach(i => {
                                let n = i.replace(new RegExp(/\\x22/), "")
                                let l = d.get(n)
                                if (l) {
                                    d.set(n, l + 1)
                                } else {
                                    d.set(n, 1)
                                }
                            })
                            var max = 0
                            var maxNumList = ""
                            console.log(d)
                            d.forEach((v, k) => {
                                if (v >= max) {
                                    max = v
                                    maxNumList = k
                                }
                            })
                            console.log(maxNumList)
                            res(maxNumList)
                        }
                    }
                }// Handle here
            );
    })
}

async function getRemoteSiteDataGrid(url: string, divid: string): Promise<boolean> {
    return new Promise((res) => {
        const iframe = document.createElement('iframe');
        const root = document.createElement('div');
        root.id = divid
        if (document.getElementById(divid) == null) {
            root.classList.add('yt-dl-hidden')
            iframe.src = url;
            root.appendChild(iframe);
            document.body.appendChild(root);
        }
        setTimeout(() => res(true), 15000)
    })
}

interface PPObj {
    link: string,
    id: string,
    title: string,
    gridItem: Element
}

var lastActiveReqs = 0
var lastReqListLength = 0
var reqList: PPObj[] = []
var activeReqs = 0

setInterval(checkActiveReqDrain, 15000)

function checkActiveReqDrain() {
    if (reqList.length > 0) {
        if (lastReqListLength == 0) {
            lastReqListLength = reqList.length
        }
        if (lastActiveReqs == 0) {
            lastActiveReqs = activeReqs
        }
        if (lastActiveReqs > 0 || lastReqListLength > 0) {
            if ((activeReqs == lastActiveReqs) || (reqList.length == lastReqListLength)) {
                activeReqs = 0
                lastActiveReqs = 0
                lastReqListLength = reqList.length
            } else {
                lastActiveReqs = activeReqs
                lastReqListLength = reqList.length
            }
        }
    }
}

function gridAlbumLinkChecker() {
    var grid = document.querySelector('[class^="style-scope ytmusic-grid-renderer"][id^="items"]')
    if (grid) {
        var gridItems = grid.querySelectorAll('[class^="style-scope ytmusic-grid-renderer"]')
        gridItems.forEach(c => {
            var albumLinkCon = c.querySelector('a');
            if (albumLinkCon) {
                var albumLink = albumLinkCon.href;
                var title = albumLinkCon.title
                if (albumLink.includes('browse')) {
                    var id = albumLink.split("browse/")[1];
                    var bc = c.querySelector('[class*="title style-scope ytmusic-two-row-item-renderer"]')
                    if (bc) {
                        var exist = bc.querySelector('[class*="yt-dl-link"]')
                        if (exist == null) {
                            if (document.getElementById(id) == null) {
                                exist = bc.querySelector('[class*="yt-dl-link"]')
                                if (exist == null) {
                                    addToRequestQueue(albumLink, id, title, c)
                                }
                            } else {

                                var idiv = document.getElementById(id)
                                if (idiv) {

                                    var items = idiv.querySelectorAll('[class^="style-scope ytmusic-shelf-renderer"]')
                                    var lastLink = ""
                                    items.forEach(i => {
                                        var a = i.querySelector('[class^="yt-simple-endpoint style-scope yt-formatted-string"]')
                                        if (a) {
                                            var link = (a as HTMLAnchorElement).href
                                            lastLink = link
                                        }
                                    })
                                    if (lastLink != "") {
                                        lastLink = lastLink.replace(/.*list=/, "")
                                        if (bc) {
                                            var meta = idiv.querySelector('[class^="metadata style-scope ytmusic-detail-header-renderer"]')
                                            if (meta) {
                                                var textField = meta.querySelector('h2')
                                                if (textField) {
                                                    var text = textField.textContent
                                                    if (text) {
                                                        var t = text.toString().trim()
                                                        var img = document.createElement("img");
                                                        img.src = chrome.runtime.getURL("download.png");
                                                        img.setAttribute("width", "25px");
                                                        img.setAttribute("height", "25px");
                                                        img.onclick = function () {
                                                            triggerDL(lastLink, t + " - Playlist")
                                                        }
                                                        var div = document.createElement('div')
                                                        div.classList.add('style-scope', 'ytmusic-item-thumbnail-overlay-renderer', 'yt-dl-link', 'yt-dl-album-cover-link')
                                                        div.appendChild(img)
                                                        div.setAttribute('role', 'button')
                                                        bc.prepend(div)
                                                    }
                                                }
                                            }
                                        }
                                    } else {
                                        console.log("subpage link returned blank")
                                    }
                                }
                            }
                        } else {
                            var ref = document.getElementById(id)
                            if (ref) {
                                document.body.removeChild(ref)
                            }
                        }
                    }
                }
            }
        })

    }
}

function addToRequestQueue(link: string, id: string, name: string, item: Element) {
    reqList.push({ link: link, id: id, title: name, gridItem: item })
}
async function processRequestQueue() {
    if (reqList.length == 0 || activeReqs >= 48) {
        for (let i = 0; i < reqList.length; i++) {
            var exist = reqList[i].gridItem.querySelector('[class*="yt-dl-link"]')
            if (exist == null) {
                const cres = await getAlbumCoverCache(async function (covercache): Promise<boolean> {
                    return new Promise(res => {
                        if (req) {
                            let cachedData = covercache.get(req.id)
                            if (cachedData && cachedData != undefined) {
                                var img = document.createElement("img");
                                img.src = chrome.runtime.getURL("download.png");
                                img.setAttribute("width", "25px");
                                img.setAttribute("height", "25px");
                                img.onclick = function () {
                                    if (cachedData)
                                        triggerDL(cachedData.link, cachedData.name)
                                }
                                img.style.zIndex = "9999"
                                var div = document.createElement('div')
                                div.classList.add('style-scope', 'yt-dl-link', 'yt-dl-album-cover-link')
                                div.appendChild(img)
                                div.setAttribute('role', 'button')
                                var bc = req.gridItem.querySelector('[class*="title style-scope ytmusic-two-row-item-renderer"]')
                                if (bc) {
                                    if (bc.querySelector('[class*="yt-dl-link"]') == null) {
                                        bc.prepend(div)
                                        res(true)
                                    }

                                } else {
                                    res(false)
                                }
                            } else {
                                res(false)
                            }
                        } else {
                            res(false)
                        }
                    })
                })
                if (cres === true) {
                    reqList.splice(i, 1)
                    return
                }
            } else {
                reqList.splice(i, 1)
            }
            return
        }
    } else {
        var req = reqList.shift()
        if (req) {
            activeReqs++;
            const cres = await getAlbumCoverCache(async function (covercache): Promise<boolean> {
                return new Promise(res => {
                    if (req) {
                        let cachedData = covercache.get(req.id)
                        if (cachedData && cachedData != undefined) {
                            var img = document.createElement("img");
                            img.src = chrome.runtime.getURL("download.png");
                            img.setAttribute("width", "25px");
                            img.setAttribute("height", "25px");
                            img.onclick = function () {
                                if (cachedData)
                                    triggerDL(cachedData.link, cachedData.name)
                            }
                            img.style.zIndex = "9999"
                            var div = document.createElement('div')
                            div.classList.add('style-scope', 'yt-dl-link', 'yt-dl-album-cover-link')
                            div.appendChild(img)
                            div.setAttribute('role', 'button')
                            var bc = req.gridItem.querySelector('[class*="title style-scope ytmusic-two-row-item-renderer"]')
                            if (bc) {
                                if (bc.querySelector('[class*="yt-dl-link"]') == null) {
                                    bc.prepend(div)
                                }
                                res(true)
                            } else {
                                res(false)
                            }
                        } else {
                            res(false)
                        }
                    } else {
                        res(false)
                    }
                })
            })
            if (cres === true) {
                activeReqs--;
                return
            } else {
                xhr(req.link).then((link) => {
                    if (req) {
                        var bc = req.gridItem.querySelector('[class*="title style-scope ytmusic-two-row-item-renderer"]')
                        if (bc) {
                            if (bc.querySelector('[class*="yt-dl-link"]') == null) {

                                var t = req.title.trim()
                                var img = document.createElement("img");
                                img.src = chrome.runtime.getURL("download.png");
                                img.setAttribute("width", "25px");
                                img.setAttribute("height", "25px");
                                img.onclick = function () {
                                    triggerDL(link, t + " - Playlist")
                                }
                                img.style.zIndex = "9999"
                                addToAlbumCoverCache(req.id, t + " - Playlist", link)
                                var div = document.createElement('div')
                                div.classList.add('style-scope', 'yt-dl-link', 'yt-dl-album-cover-link')
                                div.appendChild(img)
                                div.setAttribute('role', 'button')
                                bc.prepend(div)

                            }
                        }
                    }
                })
                activeReqs--;
            }
            /*
            getRemoteSiteDataGrid(req.link, req.id).then(() => {
                if (req) {
                    var idiv = document.getElementById(req.id)
                    if (idiv) {
                        var frame1 = idiv.querySelector('iframe')
                        if (frame1) {
                            var doc1 = frame1.contentDocument;
                            while (doc1 == null) {
                                doc1 = frame1.contentDocument;
                            }
                            var dbody = doc1.querySelector('body')
                            while (dbody == null) {
                                dbody = doc1.querySelector('body')
                            }
                            if (dbody) {
                                var itemCon = dbody.querySelector('[id^="contents"][class^="style-scope ytmusic-shelf-renderer"]')
                                if (itemCon) {
                                    console.log("itemCon")
                                }
                                var meta = dbody.querySelector('[class^="metadata style-scope ytmusic-detail-header-renderer"]')
                                if (meta) {
                                    console.log("meta")
                                }
                                if (itemCon && meta) {
                                    console.log("itemCon & meta")
                                    var rdiv = document.createElement('div')
                                    rdiv.appendChild(itemCon)
                                    rdiv.appendChild(meta)
                                    rdiv.id = req.id
                                    rdiv.classList.add('yt-dl-hidden')
                                    idiv.replaceWith(rdiv)
                                    dbody = null
                                    doc1 = null
                                    frame1.innerHTML = ""
                                    idiv.innerHTML = ""
                                    var items = rdiv.querySelectorAll('[class^="style-scope ytmusic-shelf-renderer"]')
                                    //idiv.replaceChild(dbody,)
                                    var lastLink = ""
                                    items.forEach(i => {
                                        var a = i.querySelector('[class^="yt-simple-endpoint style-scope yt-formatted-string"]')
                                        if (a) {
                                            var link = (a as HTMLAnchorElement).href
                                            lastLink = link
                                            i.replaceChildren(a)
                                        }
                                    })
                                    if (lastLink != "") {
                                        lastLink = lastLink.replace(/.*list=/, "")
                                        var bc = req.gridItem.querySelector('[class*="ytmusic-item-thumbnail-overlay-renderer"][id^="content"]')
                                        if (bc) {
                                            if (bc.querySelector('[class*="yt-dl-link"]') == null) {
                                                var meta = rdiv.querySelector('[class^="metadata style-scope ytmusic-detail-header-renderer"]')
                                                if (meta) {
                                                    var textField = meta.querySelector('h2')
                                                    if (textField) {
                                                        meta.replaceChildren(textField)
                                                        var text = textField.textContent
                                                        if (text) {
                                                            var t = text.toString().trim()
                                                            var img = document.createElement("img");
                                                            img.src = chrome.runtime.getURL("download.png");
                                                            img.setAttribute("width", "25px");
                                                            img.setAttribute("height", "25px");
                                                            img.onclick = function () {
                                                                triggerDL(lastLink, t + " - Playlist")
                                                            }
                                                            addToAlbumCoverCache(req.id, t + " - Playlist", lastLink)
                                                            var div = document.createElement('div')
                                                            div.classList.add('style-scope', 'ytmusic-item-thumbnail-overlay-renderer', 'yt-dl-link', 'yt-dl-album-cover-link')
                                                            div.appendChild(img)
                                                            div.setAttribute('role', 'button')
                                                            bc.appendChild(div)
                                                            rdiv.innerHTML = ""
                                                            itemCon.innerHTML = ""
                                                            meta.innerHTML = ""
                                                            bc = null
                                                            document.body.removeChild(rdiv)
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    } else {
                                        console.log("subpage link returned blank")
                                    }
                                }
                            }
                        }
                    }
                }
                activeReqs--;
            })
        }*/
        }
    }
}

function homePageAlbumLinkChecker() {
    var carousels = document.querySelectorAll('[class^="style-scope ytmusic-carousel"][role^="listitem"]')
    carousels.forEach(c => {
        var albumLinkCon = c.querySelector('a');
        if (albumLinkCon) {
            var albumLink = albumLinkCon.href;
            var title = albumLinkCon.title;
            if (albumLink.includes('browse')) {
                var id = albumLink.split("browse/")[1];
                var bc = c.querySelector('[class*="title style-scope ytmusic-two-row-item-renderer"]')
                if (bc) {
                    var exist = bc.querySelector('[class*="yt-dl-link"]')
                    if (exist == null) {
                        console.log('album link not set for id ' + id)
                        if (document.getElementById(id) == null) {
                            addToRequestQueue(albumLink, id, title, c)
                        } else {
                            var idiv = document.getElementById(id)
                            if (idiv) {
                                var items = idiv.querySelectorAll('[class^="style-scope ytmusic-shelf-renderer"]')
                                var lastLink = ""
                                items.forEach(i => {
                                    var a = i.querySelector('[class^="yt-simple-endpoint style-scope yt-formatted-string"]')
                                    if (a) {
                                        var link = (a as HTMLAnchorElement).href
                                        lastLink = link
                                    }
                                })
                                if (lastLink != "") {
                                    lastLink = lastLink.replace(/.*list=/, "")
                                    if (bc) {
                                        var meta = idiv.querySelector('[class^="metadata style-scope ytmusic-detail-header-renderer"]')
                                        if (meta) {
                                            var textField = meta.querySelector('h2')
                                            if (textField) {
                                                var text = textField.textContent
                                                if (text) {
                                                    var t = text.toString().trim()
                                                    var img = document.createElement("img");
                                                    img.src = chrome.runtime.getURL("download.png");
                                                    img.setAttribute("width", "25px");
                                                    img.setAttribute("height", "25px");
                                                    img.onclick = function () {
                                                        triggerDL(lastLink, t + " - Playlist")
                                                    }
                                                    img.style.zIndex = "9999"
                                                    var div = document.createElement('div')
                                                    div.classList.add('style-scope', 'yt-dl-link', 'yt-dl-album-cover-link')
                                                    div.appendChild(img)
                                                    div.setAttribute('role', 'button')
                                                    bc.prepend(div)
                                                }
                                            }
                                        }
                                    }
                                } else {
                                    console.log("subpage link returned blank")
                                }
                            }
                        }
                    } else {
                        var ref = document.getElementById(id)
                        if (ref) {
                            document.body.removeChild(ref)

                        }
                    }
                }
            } else if (albumLink.includes("list=") || albumLink.includes("watch")) {
                var bc = c.querySelector('[class*="title style-scope ytmusic-two-row-item-renderer"]')
                if (bc == null || bc == undefined) {
                    if (c.querySelector('[class*="yt-dl-link"]') == null) {
                        c.setAttribute('num-flex-columns', "4")
                        let t = c.querySelector('[class^="secondary-flex-columns"]')
                        let name = title.toString().trim()
                        var img = document.createElement("img");
                        img.src = chrome.runtime.getURL("download.png");
                        img.setAttribute("width", "25px");
                        img.setAttribute("height", "25px");
                        img.onclick = function () {
                            triggerDL(albumLink, name)
                        }
                        var div = document.createElement('div')
                        div.classList.add('flex-column', 'style-scope', 'ytmusic-responsive-list-item-renderer', 'yt-dl-link')
                        if (t) {
                            div.appendChild(img)
                            t.appendChild(div)
                        }
                    }
                } else {
                    var exist = bc.querySelector('[class*="yt-dl-link"]')
                    if (exist == null) {
                        let lastLink = albumLink.replace(/.*list=/, "")
                        var t = title.toString().trim()
                        var img = document.createElement("img");
                        img.src = chrome.runtime.getURL("download.png");
                        img.setAttribute("width", "25px");
                        img.setAttribute("height", "25px");
                        img.onclick = function () {
                            triggerDL(lastLink, t + " - Playlist")
                        }
                        img.style.zIndex = "9999"
                        var div = document.createElement('div')
                        div.classList.add('style-scope', 'yt-dl-link', 'yt-dl-album-cover-link')
                        div.appendChild(img)
                        div.setAttribute('role', 'button')
                        bc.prepend(div)
                    }
                }
            }
        }

    })
}

async function getRemoteSiteData(url: string, divid: string): Promise<boolean> {
    return new Promise((resolve) => {
        const existingDiv = document.getElementById(divid);
        if (existingDiv) {
            resolve(true); // Content already loaded
            return;
        }

        const iframe = document.createElement('iframe');
        const root = document.createElement('div');
        root.id = divid;
        root.classList.add('yt-dl-hidden'); // Apply class to hide initially

        iframe.src = url;
        root.appendChild(iframe);
        document.body.appendChild(root);

        iframe.addEventListener('load', () => {
            resolve(true); // Content loaded successfully
        });

        setTimeout(() => {
            resolve(true); // Timeout
        }, 10000);
    });
}


function playlistChecker() {
    var items = document.querySelectorAll('[class^="style-scope ytmusic-section-list-renderer"]')
    var lastLink = ""
    items.forEach(i => {
        i.setAttribute('num-flex-columns', "4")
        var a = i.querySelector('[class^="yt-simple-endpoint style-scope yt-formatted-string"]')
        if (a) {
            var link = (a as HTMLAnchorElement).href
            lastLink = link
            var text = (a as HTMLAnchorElement).text
            if (i.querySelector('[class*="yt-dl-link"]') == null) {
                var t = i.querySelector('[class^="secondary-flex-columns"]')
                var img = document.createElement("img");
                img.src = chrome.runtime.getURL("download.png");
                img.setAttribute("width", "25px");
                img.setAttribute("height", "25px");
                img.onclick = function () {
                    triggerDL(link, text)
                }
                var div = document.createElement('div')
                div.classList.add('flex-column', 'style-scope', 'ytmusic-responsive-list-item-renderer', 'yt-dl-link')
                if (t) {
                    div.appendChild(img)
                    t.appendChild(div)
                }
            }
        }
    })
    var items = document.querySelectorAll('[class^="style-scope ytmusic-playlist-shelf-renderer"]')
    items.forEach(i => {
        i.setAttribute('num-flex-columns', "4")
        var a = i.querySelector('[class^="yt-simple-endpoint style-scope yt-formatted-string"]')
        if (a) {
            var link = (a as HTMLAnchorElement).href
            lastLink = link
            var text = (a as HTMLAnchorElement).text

            var t = i.querySelector('[class^="secondary-flex-columns"]')
            var img = document.createElement("img");
            img.src = chrome.runtime.getURL("download.png");
            img.setAttribute("width", "25px");
            img.setAttribute("height", "25px");
            img.onclick = function () {
                triggerDL(link, text)
            }
            var div = document.createElement('div')
            div.classList.add('flex-column', 'style-scope', 'ytmusic-responsive-list-item-renderer', 'yt-dl-link')
            if (t) {
                if (i.querySelector('[class*="yt-dl-link"]') == null) {
                    div.appendChild(img)
                    t.appendChild(div)
                }
            }
            var queueItems = document.querySelectorAll('[class^="style-scope ytmusic-player-queue"]')
            queueItems.forEach(q => {
                var qt = q.querySelector('[class^="song-title style-scope ytmusic-player-queue-item"]')
                if (qt) {
                    if (text === qt.textContent && q.querySelector('[class*="yt-dl-link"]') == null) {
                        var qdiv = document.createElement('div')
                        qdiv.classList.add('yt-dl-link')
                        qdiv.appendChild(img)
                        q.appendChild(qdiv)
                    }
                }
            })
        }
    })
    albumPlaylist(lastLink)
}

function albumPlaylist(link: string) {
    link = link.replace(/.*list=/, "")
    var menu = document.querySelector('[class^="detail-page-menu style-scope ytmusic-detail-header-renderer"]')
    if (menu != null) {
        if (menu.querySelector('[class*="yt-dl-link"]') == null) {
            var meta = document.querySelector('[class^="metadata style-scope ytmusic-detail-header-renderer"]')
            if (meta) {
                var textField = meta.querySelector('h2')
                if (textField) {
                    var text = textField.textContent
                    if (text) {
                        var t = text.toString().trim()
                        var img = document.createElement("img");
                        img.src = chrome.runtime.getURL("download.png");
                        img.setAttribute("width", "25px");
                        img.setAttribute("height", "25px");
                        img.onclick = function () {
                            triggerDL(link, t + " - Playlist")
                        }
                        var div = document.createElement('div')
                        div.classList.add('style-scope', 'ytmusic-menu-renderer', 'yt-dl-link')
                        div.appendChild(img)
                        menu.appendChild(div)
                    }
                }
            }
        }
    }
}

function listChecker() {
    var items = document.querySelectorAll('[class^="style-scope ytmusic-shelf-renderer"]')
    items.forEach(i => {
        i.setAttribute('num-flex-columns', "4")
        var a = i.querySelector('[class^="yt-simple-endpoint style-scope yt-formatted-string"]')
        if (a) {
            var link = (a as HTMLAnchorElement).href
            var text = (a as HTMLAnchorElement).text
            if (i.querySelector('[class*="yt-dl-link"]') == null) {
                var t = i.querySelector('[class^="secondary-flex-columns"]')
                var img = document.createElement("img");
                img.src = chrome.runtime.getURL("download.png");
                img.setAttribute("width", "25px");
                img.setAttribute("height", "25px");
                img.onclick = function () {
                    triggerDL(link, text)
                }
                var div = document.createElement('div')
                div.classList.add('flex-column', 'style-scope', 'ytmusic-responsive-list-item-renderer', 'yt-dl-link')
                if (t) {
                    div.appendChild(img)
                    t.appendChild(div)
                }
            }
        }
    })
}

function nowPlayingChecker() {
    var npLinkCon = document.querySelector('[class^="ytp-title-link"]')
    if (npLinkCon) {
        var npLink = npLinkCon as HTMLAnchorElement
        if (npLink) {
            var nplinksan = npLink.href.replace(/\?.*\&/, '?')
            var nplinkname = npLink.text
        }
    }
    var playerLikeBar = document.querySelector('[class^="thumbs style-scope ytmusic-player-bar"]')
    if (playerLikeBar) {
        var likeButtonCon = playerLikeBar.querySelector('[class^="like style-scope ytmusic-like-button-renderer"][id^="button-shape-like"]')
        if (likeButtonCon) {
            var likeButton = likeButtonCon.querySelector('button')
            if (likeButton) {
                likeButton.onclick = function () {
                    triggerDL(nplinksan, nplinkname)
                }
            }
        }
        var controlGroup = playerLikeBar.parentElement
        if (controlGroup) {
            if (controlGroup.querySelector('[class*="yt-dl-link"]') == null) {
                var img = document.createElement("img");
                img.src = chrome.runtime.getURL("download.png");
                img.setAttribute("width", "25px");
                img.setAttribute("height", "25px");
                img.onclick = function () {
                    triggerDL(nplinksan, nplinkname)
                }
                var div = document.createElement('div')
                div.appendChild(img)
                div.classList.add('yt-dl-link')
                controlGroup.appendChild(div)
            } else {
                var old = controlGroup.querySelector('[class*="yt-dl-link"]')
                if (old) {
                    var img = document.createElement("img");
                    img.src = chrome.runtime.getURL("download.png");
                    img.setAttribute("width", "25px");
                    img.setAttribute("height", "25px");
                    img.onclick = function () {
                        triggerDL(nplinksan, nplinkname)
                    }
                    var div = document.createElement('div')
                    div.appendChild(img)
                    div.classList.add('yt-dl-link')
                    controlGroup.replaceChild(div, old)
                }
            }
        }
    }
}

function shareLinkChecker() {
    const cpybtn = document.getElementById("copy-button");
    const startat = document.getElementById("start-at-timestamp");
    if (cpybtn && startat) {
        const resLink = (document.getElementById("share-url") as HTMLInputElement).value;
        const dlbtn = document.createElement("button");
        dlbtn.id = "ytdlbtn";
        dlbtn.className = "yt-spec-button-shape-next yt-spec-button-shape-next--filled yt-spec-button-shape-next--call-to-action yt-spec-button-shape-next--size-m";
        const indiv = document.createElement("div");
        indiv.className = "yt-spec-button-shape-next__button-text-content";
        const inspan = document.createElement("span");
        inspan.textContent = "Download";

        dlbtn.onclick = function () {
            triggerDL(resLink, "");

        }

        if (!document.getElementById("ytdlbtn")) {
            indiv.appendChild(inspan);
            dlbtn.appendChild(indiv);
            startat.insertAdjacentElement("afterend", dlbtn);
        }
    }
}

async function triggerDL(ytlink: string, name: string) {
    console.log('dl triggered: link:' + ytlink + ' name:' + name)
    addToDB(ytlink, "dl_dl", name)
    startloader("info", "Download Initiated!");
    chrome.runtime.sendMessage({ ytlink: ytlink, name: name });
}

function startloader(type: string, msg: string) {
    const loaderdiv = document.createElement("div");
    loaderdiv.id = "ytmdl-load-div";
    loaderdiv.setAttribute("data-component", "dismissible-item");
    loaderdiv.setAttribute("data-type", type);
    loaderdiv.setAttribute("data-value", msg);
    const layout = document.getElementById("layout");
    if (layout) {
        layout.insertBefore(loaderdiv, layout.firstChild);
        dismissiblefunc();
        setTimeout(stoploader, 3000);
    }
}

function stoploader() {
    const ld = document.getElementById("ytmdl-load-div");
    if (ld) {
        document.getElementById("layout")?.removeChild(ld);
    }
}

async function acknowledgeWarning(id: string) {
    chrome.runtime.sendMessage({ acknowledge: id })
}

function triggerWarning(msg: string, id: string) {
    const warningdiv = document.createElement("div");
    warningdiv.id = "ytmdl-warning-div";
    warningdiv.setAttribute("data-component", "dismissible-item");
    warningdiv.setAttribute("data-type", "warning");
    warningdiv.setAttribute("data-value", msg + `<button id="acknowledge-button">Acknowledge</button>`);
    document.addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        if (target && target.id === 'acknowledge-button') {
            warningdiv.remove(); // Remove the warning div when the button is clicked
            acknowledgeWarning(id);
        }
    });
    const layout = document.getElementById("layout");
    if (layout) {
        layout.insertBefore(warningdiv, layout.firstChild);
        dismissiblefunc();
    }

}

function dismissiblefunc() {
    const dismissibleItem = (el: DismissibleElement, type: string, value: string) => {
        const html = `<span>${value} <button type="button" class="close">X</button></span>`;

        el.removeAttribute('data-component');
        el.removeAttribute('data-value');
        el.removeAttribute('data-type');
        el.classList.add('dismissible', `dismissible-${type}`);
        el.innerHTML = html;
        el.querySelector('.close')?.addEventListener('click', (event) => {
            let height = el.offsetHeight,
                opacity = 1,
                timeout: number | null = null;

            const reduceHeight = () => {
                height -= 2;
                el.setAttribute('style', `height: ${height}px; opacity: ${opacity}`);
                if (height <= 0) {
                    window.clearInterval(timeout!);
                    timeout = null;
                    el.remove();
                }
            };

            const fade = () => {
                opacity -= 0.1;
                el.setAttribute('style', `opacity: ${opacity}`);
                if (opacity <= 0) {
                    window.clearInterval(timeout!);
                    timeout = window.setInterval(reduceHeight, 1);
                }
            };

            timeout = window.setInterval(fade, 25);
        });
    };

    const dismissibles = Array.from(document.querySelectorAll<HTMLElement>('[data-component="dismissible-item"]'));
    if (dismissibles.length) {
        for (let i = 0; i < dismissibles.length; i++) {
            const type = dismissibles[i].getAttribute('data-type'),
                value = dismissibles[i].getAttribute('data-value');
            if (type && value) {
                dismissibleItem(dismissibles[i] as DismissibleElement, type, value);
            }
        }
    }
}

async function getAlbumCoverCache(callback: (db: Map<string, AlbumLinkDetails>) => Promise<boolean>): Promise<boolean> {
    return new Promise((resolve) => {
        chrome.storage.local.get("albumcache", async function (result) {
            let r = false;
            const albumcache = result.albumcache;
            if (albumcache) {
                const db = new Map<string, AlbumLinkDetails>(Object.entries(albumcache));
                r = await callback(db);
            } else {
                const db = new Map<string, AlbumLinkDetails>();
                r = await callback(db);
            }
            resolve(r);
        });
    });
}


async function addToAlbumCoverCache(id: string, name: string, link: string) {
    await getAlbumCoverCache(function (db): Promise<boolean> {
        return new Promise((res) => {
            var n: AlbumLinkDetails = { id: id, name: name, link: link };
            db.set(id, n);
            chrome.storage.local.set({ "albumcache": Object.fromEntries(db) });
            res(true)
        })

    })
}

function getDB(callback: (db: Map<string, YTDetails>) => void) {
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

function addToDB(item: string, state: string, name: string) {
    getDB(function (db) {
        var n: YTDetails = { link: item, state: state, name: name };
        db.set(item, n);
        chrome.storage.local.set({ "downloaddb": Object.fromEntries(db) });
    });
}

function removeFromDB(item: string) {
    getDB(function (db) {
        db.delete(item)
        chrome.storage.local.set({ "downloaddb": Object.fromEntries(db) })
    })
}

function clearDB() {
    chrome.storage.local.clear()
}