var vscode = require("vscode")
const fs = require("fs");

function getFiles(dir, p) {
    p = p || {
        name: "",
        files: []
    }
    return new Promise(function(resolve, reject) {
        fs.readdir(dir, function(err, filenames) {
            if (err) reject(err)
            let ps = []
            for (let filename of filenames) {
                let stat = fs.statSync(dir + filename)
                if (stat.isFile()) {
                    if (filename.endsWith(".json"))
                        p.files.push(p.name + filename)
                } else if (stat.isDirectory()) {
                    let c = {
                        name: p.name + filename + "/",
                        files: p.files
                    }
                    ps.push(getFiles(dir + filename + "/", c))
                }
            }
            Promise.all(ps).then(() => resolve(p.files))
        })
    })
}

function getAliasDir(document, alias) {
    let path = vscode.workspace.getWorkspaceFolder(document.uri).uri.path
    let map = {}
    try {
        map = JSON.parse(fs.readFileSync(path + "/" + "config.json")).alias
    } catch (error) {
        console.log(error)
    }
    return map[alias]
}

function getApiDir(document) {
    let doc = vscode.window.activeTextEditor.document
    let lineone = document.getText(document.lineAt(0).range)
    let ss = lineone.split("test:")
    if (ss.length === 2) {
        ss = ss[1].trim()
        if (fs.existsSync(ss))
            return ss
        ss = getAliasDir(document, ss)
        if (fs.existsSync(ss))
            return ss
    }
    ss = document.fileName.split("/")
    if (ss[ss.length-3]==="test") {
        ss = getAliasDir(document, ss[ss.length-2])
        if (fs.existsSync(ss))
            return ss
    }
}

class ApiProvider {
    constructor(cache, config) {
        this.config = {
            postFunc: 'request.postForm',
            getFunc: 'request.get',
            completionTrigger: '',
        }
        Object.assign(this.config, config)
        this.cache = cache
    }
    updateConfig() {
        let config = vscode.workspace.getConfiguration()
        this.config.postFunc = config.get('greenjs.test.postFunc')
        this.config.getFunc = config.get('greenjs.test.getFunc')
        this.config.completionTrigger = config.get('greenjs.test.completionTrigger')
    }
    getHover(document, position, api) {
        let linenum = position.line;
        let line = document.lineAt(linenum)
        let b = position.character
        let e = position.character
        for (; b >= 0; b--) {
            if (line.text.charAt(b) == '"')
                break
        }
        if (b < 0)
            return null
        for (; e < line.range.end.character; e++) {
            if (line.text.charAt(e) == '"')
                break
        }
        if (e >= line.range.end.character)
            return null
        let text = line.text.slice(b + 2, e)
        let item = api.map[text]
        if (!item) {
            return null
        }
        return new vscode.Hover([item.detail, item.documentation])
    }
    // 悬浮提示
    provideHover(document, position, token) {
        let dir = getApiDir(document)
        if (!dir) return []
        let api = this.cache[dir]
        if (!api) {
            return new Promise((resolve, reject) => {
                this.provideCompletionItems(document, position, token).then(() => {
                    api = this.cache[dir]
                    resolve(this.getHover(document, position, api))
                }, console.error)
            })
        }
        return this.getHover(document, position, api)
    }
    getLinks(document, api, dir) {
        // var document = vscode.window.activeTextEditor.document
        let text = document.getText()
        var re = /"[\w\/]+"/g
        var links = [],
            m;
        while (m = re.exec(text)) {
            let s = m[0].slice(2, m[0].length - 1)
            if (api.map[s]) {
                let range = new vscode.Range(document.positionAt(m.index + 1), document.positionAt(m.index + 2 + s.length))
                let link = new vscode.DocumentLink(range, new vscode.Uri.file(dir + s + ".json"))
                links.push(link)
            }
        }
        return links
    }
    // 链接跳转
    provideDocumentLinks(document, token) {
        let dir = getApiDir(document)
        if (!dir) return []
        let api = this.cache[dir]
        if (!api) {
            return new Promise((resolve, reject) => {
                this.provideCompletionItems(document, null, token).then(() => {
                    api = this.cache[dir]
                    resolve(this.getLinks(document, api, dir))
                }, console.error)
            })
        }
        return this.getLinks(document, api, dir)
    }
    resolveDocumentLink(link, token) {
        return link
    }
    // 补全
    provideCompletionItems(document, position, token, context) {
        let dir = getApiDir(document)
        if (!dir) return []
        let api = this.cache[dir] || {
            update_at: 0,
            runtime: 0,
            map: {}
        }
        let start_at = new Date().getTime()
        if (start_at < api.update_at + api.runtime) {
            return api.items
        }
        if (api.update_at) // 运行过之后等待下次运行
            api.update_at = start_at
        let that = this;
        return new Promise(function(resolve, reject) {
            that.updateConfig()
            getFiles(dir).then(function(files) {
                let map = api.map
                let items = files.map(name => {
                    name = name.slice(0, name.length - 5)
                    var completionItem = map[name]
                    if (!completionItem) {
                        completionItem = new vscode.CompletionItem(name);
                        completionItem.kind = vscode.CompletionItemKind.Snippet;
                        completionItem.detail = `/${name}`;
                        completionItem.filterText = that.config.completionTrigger + name;
                        map[name] = completionItem
                    }
                    completionItem.filename = dir + name + ".json"
                    return completionItem
                })
                let update_at = new Date().getTime()
                that.cache[dir] = {
                    update_at,
                    runtime: update_at - start_at + 500,
                    items,
                    map
                }
                console.log(update_at - start_at + 500)
                setTimeout(function() {
                    items.forEach(x => that.resolveCompletionItem(x))
                })
                resolve(items)
            }, reject)
        })
    }
    resolveCompletionItem(item, token) {
        if (!item.filename) return item
        let content = fs.readFileSync(item.filename)
        let d = new Function("return " + content)()
        let ss = [],
            s
        let postFunc = this.config.postFunc
        let getFunc = this.config.getFunc
        if (Object.keys(d.params || {}).length) {
            if (d.method == "GET") {
                ss.push(`${getFunc}("/${item.label}",{ // ${d.name}`)
            } else {
                ss.push(`${postFunc}("/${item.label}",{ // ${d.name}`)
            }
            var i = 1;
            for (let k in d.params) {
                let v = d.params[k]
                let s
                if (v.def) {
                    if (typeof v.def === "number") {
                        s = `    ${k}: $\{${i}:${v.def}},`
                    } else {
                        s = `    ${k}: "$\{${i}:${v.def}}",`
                    }
                } else if (v.type && (v.type == "int" || v.type == "float")) {
                    s = `    ${k}: $\{${i}:1},`
                } else {
                    s = `    ${k}: "\$${i}",`
                }
                if (v.lbl || v.rem) {
                    s += " //" + (v.lbl || v.rem)
                }
                ss.push(s)
                i++;
            }
            ss.push("})")
            s = ss.join("\n")
        } else {
            if (d.method == "GET") {
                s = `${getFunc}("/${item.label}") // ${d.name}`
            } else {
                s = `${postFunc}("/${item.label}") // ${d.name}`
            }
        }
        item.detail = `[${d.method}] - ${d.name}`
        let docs = [
            "``` javascript",
            s,
            "```",
            "##### 返回值",
            "``` json",
            JSON.stringify(d.ret, null, 4),
            "```"
        ]
        item.documentation = new vscode.MarkdownString(docs.join("\n"))
        item.insertText = new vscode.SnippetString(s)
        delete item.filename
        return item;
    }
    dispose() {}
}

module.exports = ApiProvider