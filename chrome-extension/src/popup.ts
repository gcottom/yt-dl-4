interface YTDetails {
    link: string
    name: string
    state: string
}

setInterval(getData, 200);
setInterval(checkForButtonHandler, 500);

function checkForButtonHandler() {
    var c = document.getElementById('clear')
    if (c) {
        c.onclick = function () { clear() }
    }
}

function getData() {
    chrome.storage.local.get("downloaddb", function (result) {
        const downloaddb = result.downloaddb;
        if (downloaddb) {
            const db = new Map<string, YTDetails>(Object.entries(downloaddb));

            var exist = document.getElementById("dl_dl")
            if (exist == null) {
                var downloading = document.createElement('div')
                downloading.textContent = "Downloading"
                downloading.id = "dl_dl"
            } else {
                downloading = exist as HTMLDivElement
            }
            exist = document.getElementById("dl_done")
            if (exist == null) {
                var done = document.createElement('div')
                done.textContent = "Done"
                done.id = "dl_done"
            } else {
                done = exist as HTMLDivElement
            }
            exist = document.getElementById("spacer")
            if (exist == null) {
                var spacer = document.createElement('div')
                spacer.style.height = "15px"
                spacer.id = "spacer"
            } else {
                spacer = exist as HTMLDivElement
            }

            for (let [key, value] of db) {
                var exist = document.getElementById(key)
                if (exist != null) {
                    var p = exist.parentElement
                    if (p) {
                        if (p.id != value.state) {
                            p.removeChild(exist)
                        } else {
                            continue
                        }
                    }
                }
                var item = document.createElement('li')
                item.textContent = value.name
                item.id = key
                if (value.state == "dl_done") {
                    done.appendChild(item)
                } else {
                    downloading.appendChild(item)
                }
            }
            var main = document.getElementById("main")
            if (main) {
                main.appendChild(downloading)
                main.appendChild(spacer)
                main.appendChild(done)
            }
        }
    })
}

function clear() {
    chrome.storage.local.clear()
    var dl = document.getElementById("dl_dl")
    if (dl) {
        while (dl.lastChild != null) {
            dl.removeChild(dl.lastChild)
        }
    }
    var done = document.getElementById("dl_done")
    if (done) {
        while (done.lastChild != null) {
            done.removeChild(done.lastChild)
        }
    }
}