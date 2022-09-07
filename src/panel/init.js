const errorHandler = e => {
    const errorElement = document.getElementById('error')
    errorElement.innerText = `Error: ${e.error.message}`;
    errorElement.style.display = 'block';
}
window.addEventListener('error', errorHandler);
window.addEventListener('unhandledrejection', errorHandler)

vscode = acquireVsCodeApi();
(() => {
    function getMetaContent(name) {
        // We assert the meta name exists as they are hardcoded in the `webview.html`.
        return document.querySelector(`meta[name="${name}"]`).content
    }

    const store = new Store(
        JSON.parse(getMetaContent('storeState')),
        getMetaContent('storeWorkspaceUri') || undefined,
    )
    store.banner = getMetaContent('storeBanner')
    ReactDOM.render(
        React.createElement(Index, { store }),
        document.getElementById('root'),
    )
})();
