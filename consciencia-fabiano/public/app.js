  loadHistory();
  renderHistory();
  switchPanel(location.pathname === "/admin" ? "library" : "chat");
  checkBackend();
  loadBooks();
})();