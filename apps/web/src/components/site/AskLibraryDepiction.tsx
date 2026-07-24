/**
 * Ask Library depiction — the retrieval-grounded, Socratic chat over the
 * reader's own library. Built new, in the same visual vocabulary as the
 * ported campaign depictions (`.product-frame` + `.app-chrome`), because
 * the campaign site predates this feature.
 *
 * The copy is deliberately constrained to what the feature actually does:
 * retrieval is scoped to the reader's own eligible content; a substantive
 * answer must carry a citation drawn from what was really retrieved; a
 * question with no supporting evidence returns an explicit not-found
 * rather than an invented answer; and the answer is quoted from the
 * retrieved passage rather than composed over it. No "AI" wording
 * (standing rule D-22-23) — the basis of the answer is stated instead.
 *
 * Static: nothing here is interactive, so it stays a server component.
 */
export function AskLibraryDepiction() {
  return (
    <div className="product-frame chat-rendering">
      <div className="app-chrome">
        <div className="app-brand"><span className="app-mark">P</span><b>Palimnote</b></div>
        <div className="global-nav"><span>Dashboard</span><span>Works</span><span>Library</span><span>Graph</span><span className="active">Ask Library</span></div>
        <span className="demo-badge">Working product · Beta</span>
      </div>
      <div className="chat-shell">
        <div className="chat-header">
          <div>
            <small>GROUNDED IN YOUR OWN LIBRARY</small>
            <h3>Ask Library</h3>
            <p>Ask a question about what you have read. The answer is assembled from passages actually retrieved from your own uploads and your explicitly licensed sources — then it asks you something back.</p>
          </div>
          <span className="chat-scope">Retrieval scope · your library only</span>
        </div>

        <div className="chat-thread">
          <div className="chat-turn chat-ask">
            <b>You</b>
            <div className="chat-body">
              <p>Does the argument treat vice as a failure of knowledge or a failure of formation?</p>
            </div>
          </div>

          <div className="chat-turn chat-answer">
            <b>Palimnote</b>
            <div className="chat-body">
              <p>
                Two passages in your library bear on this directly. The primary work separates what a person knows
                from what a person has become capable of seeing, and treats the second as prior. The retrieved
                passage is quoted below with the anchor it came from.
              </p>
              <div className="chat-citation">
                <span aria-hidden="true">§</span>
                <span>
                  <b>Vice and Reason — § 3, p. 14</b>
                  <small>Your upload · reader anchor · block 42</small>
                  <em>
                    &ldquo;The failure of judgment may therefore concern not only what a person knows, but what a
                    person has become capable of seeing.&rdquo;
                  </em>
                </span>
              </div>
              <p className="chat-socratic">
                So: if seeing precedes knowing here, what would a purely intellectual correction actually be able to
                fix?
              </p>
            </div>
          </div>

          <div className="chat-turn chat-empty">
            <b>You</b>
            <div className="chat-body">
              <p>What did the reviewers of this book say about chapter five?</p>
              <p className="chat-notfound">
                <strong>No supporting evidence in your library.</strong> Nothing retrieved covers this, so there is no
                answer to give. Add a source that does, or open the Library to see what is referenced but not yet
                acquired.
              </p>
            </div>
          </div>
        </div>

        <div className="chat-guardrails">
          <div>
            <b>Your library only</b>
            <span>Retrieval never reaches outside your own uploads and the sources you hold under an explicit open licence.</span>
          </div>
          <div>
            <b>A citation or nothing</b>
            <span>Every substantive answer carries the passage it came from. Without one, you get a not-found instead.</span>
          </div>
          <div>
            <b>A question back</b>
            <span>The reply states what the evidence supports, then asks one question you can use to test it against the text.</span>
          </div>
        </div>
      </div>
      <div className="demo-footnote">Illustrative interface rendering · Quoted passage is from the sample work used throughout this page.</div>
    </div>
  );
}
