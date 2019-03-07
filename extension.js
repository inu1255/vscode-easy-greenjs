var vscode = require('vscode');
const ApiProvider = require("./src/ApiProvider");

function activate(context) {
    let cache = {}
    var provider = new ApiProvider(cache)
    var disposable
    disposable = vscode.languages.registerCompletionItemProvider("javascript", provider)
    context.subscriptions.push(disposable);
    disposable = vscode.languages.registerHoverProvider("javascript", provider)
    context.subscriptions.push(disposable);
    disposable = vscode.languages.registerDocumentLinkProvider("javascript", provider)
    context.subscriptions.push(disposable);
}
exports.activate = activate;

function deactivate() {
}
exports.deactivate = deactivate;