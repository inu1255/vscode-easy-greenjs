var vscode = require('vscode');
const ApiProvider = require("./src/ApiProvider");

function activate(context) {
    let cache = {}
    var disposable
    disposable = vscode.languages.registerCompletionItemProvider("javascript", new ApiProvider(cache))
    context.subscriptions.push(disposable);
    disposable = vscode.languages.registerHoverProvider("javascript", new ApiProvider(cache))
    context.subscriptions.push(disposable);
    disposable = vscode.languages.registerDocumentLinkProvider("javascript", new ApiProvider(cache))
    context.subscriptions.push(disposable);
}
exports.activate = activate;

function deactivate() {
}
exports.deactivate = deactivate;