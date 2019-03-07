var vscode = require("vscode")
const fs = require("fs");
const path = require("path");

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
                let file = path.join(dir, filename)
                let stat = fs.statSync(file)
                if (stat.isFile()) {
                    if (filename.endsWith(".json"))
                        p.files.push(p.name + filename)
                } else if (stat.isDirectory()) {
                    let c = {
                        name: p.name + filename + "/",
                        files: p.files
                    }
                    ps.push(getFiles(file, c))
                }
            }
            Promise.all(ps).then(() => resolve(p.files))
        })
    })
}

function getApiDir(document, apiDir) {
    let ss = document.fileName.split(path.sep)
    let i = ss.indexOf('public')
    let dir = ''
    if (i < 0) i = ss.indexOf('routes')
    if (i < 0) return ''
    dir = ss.slice(0, i).concat(apiDir).join(path.sep)
    if (fs.existsSync(dir))
        return dir
    return ''
}

class ApiProvider {
    constructor(cache) {
        this.config = vscode.workspace.getConfiguration()
        this.cache = cache
    }
    get postFunc() {
        return this.config.get('greenjs.postFunc')
    }
    get getFunc() {
        return this.config.get('greenjs.getFunc')
    }
    get completionTrigger() {
        return this.config.get('greenjs.completionTrigger')
    }
    get apiDir() {
        return this.config.get('greenjs.apiDir')
    }
    get apiPath() {
        return this.config.get('greenjs.apiPath')
    }
    getHover(document, position, api) {
        let linenum = position.line;
        let line = document.lineAt(linenum)
        let b = position.character
        let e = position.character
        let c
        for (; b >= 0; b--) {
            c = line.text.charAt(b)
            if (c == '"' || c == "'")
                break
        }
        if (b < 0)
            return null
        for (; e < line.range.end.character; e++) {
            if (line.text.charAt(e) == c)
                break
        }
        if (e >= line.range.end.character)
            return null
        let key = this.resolve(line.text.slice(b + 1, e))
        let item = api.map[key]
        if (!item) return null
        this.resolveCompletionItem(item)
        return new vscode.Hover([item.detail, item.documentation])
    }
    resolve(text) {
        let ss = text.split("/")
        while (ss.length) {
            if (ss[0] == "." || ss[0] == "") ss.shift()
            else if (ss[0] == "..") ss = ss.slice(2)
            else break
        }
        return ss.join("/").replace(/\.json$/, '')
    }
    // 悬浮提示
    provideHover(document, position, token) {
        let dir = this.apiPath || getApiDir(document, this.apiDir)
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
        var re = /(["'])[^"'\s]+\1/g
        var links = [],
            m;
        while (m = re.exec(text)) {
            let key = this.resolve(m[0].slice(1, -1))
            if (api.map[key]) {
                let range = new vscode.Range(document.positionAt(m.index + 1), document.positionAt(m.index + m[0].length))
                let link = new vscode.DocumentLink(range, vscode.Uri.file(path.join(dir, key + ".json")))
                links.push(link)
            }
        }
        return links
    }
    // 链接跳转
    provideDocumentLinks(document, token) {
        let dir = this.apiPath || getApiDir(document, this.apiDir)
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
        let dir = this.apiPath || getApiDir(document, this.apiDir)
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
        return new Promise((resolve, reject) => {
            getFiles(dir).then((files) => {
                let map = api.map
                let items = files.filter(x => x.endsWith('.json')).map(name => {
                    name = name.slice(0, name.length - 5)
                    var completionItem = map[name]
                    if (!completionItem) {
                        completionItem = new vscode.CompletionItem(name);
                        completionItem.kind = vscode.CompletionItemKind.Snippet;
                        completionItem.detail = `/${name}`;
                        completionItem.filterText = this.completionTrigger + name;
                        map[name] = completionItem
                    }
                    completionItem.filename = path.join(dir, name + ".json")
                    return completionItem
                })
                let update_at = new Date().getTime()
                this.cache[dir] = {
                    update_at,
                    runtime: update_at - start_at + 500,
                    items,
                    map
                }
                console.log(update_at - start_at + 500)
                setTimeout(function() {
                    items.forEach(x => this.resolveCompletionItem(x))
                })
                resolve(items)
            }, reject)
        })
    }
    resolveCompletionItem(item) {
        if (!item.filename) return item
        let stat = fs.statSync(item.filename)
        let t = stat.mtime.getTime()
        if (t <= item.update_at) return item
        item.update_at = t
        let content = fs.readFileSync(item.filename)
        let d
        try { d = new Function("return " + content)() } catch (error) {
            return item
        }
        let i = 1;
        let body = ''
        if (d.params) {
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
                body += s + "\n"
                i++;
            }
        }
        body += "}"
        let method = d.method || 'any'
        let s = method.toLowerCase() == "get" ? this.getFunc : this.postFunc
        s = s.replace(/\$(\{?)(\d+)/g, function(x0, f, n) {
            return `$${f}${+n+i-1}`
        })
        s = s.replace(/\{B\}/, '{\n' + body)
        s = s.replace(/\{NB\}/, `{ // ${d.name}\n` + body)
        s = s.replace(/\{U\}/g, item.label)
        s = s.replace(/\{N\}/g, d.name)
        item.detail = `[${method}] - ${d.name}`
        let docs = [
            "``` javascript",
            s,
            "```",
            "##### 返回值",
            "``` json",
            JSON.stringify(d.ret, null, 2),
            "```"
        ]
        item.documentation = new vscode.MarkdownString(docs.join("\n"))
        item.insertText = new vscode.SnippetString(s)
        return item;
    }
    dispose() {}
}

module.exports = ApiProvider