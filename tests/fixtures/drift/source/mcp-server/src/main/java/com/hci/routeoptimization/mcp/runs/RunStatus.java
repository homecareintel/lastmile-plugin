package example.runs;

/** Synthetic fixture. */
public enum RunStatus {
    /** Waiting. */
    WAITING,
    BUSY,
    DONE,
    BROKEN;

    public boolean active() {
        return this == WAITING || this == BUSY;
    }
}
