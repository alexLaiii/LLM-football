export default function HistoryLoading() {
  return (
    <div className="terminal-page history-terminal-page">
      <div className="terminal-content history-content">
        <div className="terminal-loading">
          <div className="terminal-loading-status">
            <span>LOADING AI WAGER LEDGER</span>
            <div className="terminal-loading-progress"><span /></div>
          </div>
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="terminal-skeleton-row">
              <span /><span className="is-avatar" /><span /><span /><span /><span />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
