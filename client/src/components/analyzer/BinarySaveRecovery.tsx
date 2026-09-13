export function BinarySaveRecovery({
  onChooseFile,
}: {
  onChooseFile: () => void;
}) {
  return (
    <section
      className="binary-save-recovery"
      aria-labelledby="binary-save-recovery-title"
    >
      <div className="binary-save-recovery-intro">
        <span className="batch-analysis-eyebrow">Compatible save required</span>
        <h2 id="binary-save-recovery-title">
          This save needs conversion before analysis
        </h2>
        <p>
          We recognized a valid Hearts of Iron IV binary save. You do not need
          to restart this campaign, and Hearts of Iron IV can still load the
          existing save normally.
        </p>
      </div>

      <details className="binary-save-recovery-steps">
        <summary>How to create a compatible save</summary>
        <div className="binary-save-recovery-body">
          <ol>
            <li>Close Hearts of Iron IV.</li>
            <li>
              Open the Hearts of Iron IV <code>settings.txt</code> file.
            </li>
            <li>
              Find <code>save_as_binary=yes</code>.
            </li>
            <li>
              Change it to <code>save_as_binary=no</code> and save the file.
            </li>
            <li>Start Hearts of Iron IV.</li>
            <li>Load the same existing campaign save.</li>
            <li>Save the campaign again under a new name.</li>
            <li>Upload the newly created save to the analyzer.</li>
          </ol>

          <div className="binary-save-recovery-location">
            <h3>Where to find settings.txt</h3>
            <p>
              Open Documents → Paradox Interactive → Hearts of Iron IV →
              settings.txt.
            </p>
            <code>
              {"%USERPROFILE%\\Documents\\Paradox Interactive\\Hearts of Iron IV\\settings.txt"}
            </code>
            <p>
              If Windows manages Documents through OneDrive, use the Documents
              folder inside OneDrive instead.
            </p>
          </div>

          <p className="binary-save-recovery-note">
            <strong>The setting change does not convert the old file.</strong>{" "}
            Load that existing save in Hearts of Iron IV and save it again to
            create the compatible copy.
          </p>
          <p className="binary-save-recovery-note">
            <strong>This is normally a one-time compatibility setup.</strong>{" "}
            New saves created after <code>save_as_binary=no</code> is configured
            should already use the compatible text format.
          </p>
        </div>
      </details>

      <button
        type="button"
        className="button button-secondary analyzer-status-action"
        onClick={onChooseFile}
      >
        Choose converted save
      </button>
    </section>
  );
}
