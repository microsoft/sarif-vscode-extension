vscode = acquireVsCodeApi();
(async () => {
    function getMetaContent(name) {
        // We assert the meta name exists as they are hardcoded in the `webview.html`.
        return document.querySelector(`meta[name="${name}"]`).content
    }

    const store = new Store(
        JSON.parse(getMetaContent('storeState')),
        getMetaContent('storeWorkspaceUri') || undefined,
    )
    store.banner = getMetaContent('storeBanner')
    await store.onMessage({ data: JSON.parse(getMetaContent('spliceLogsMessage')) })
    ReactDOM.render(
        React.createElement(Index, { store }),
        document.getElementById('root'),
    )
})();
