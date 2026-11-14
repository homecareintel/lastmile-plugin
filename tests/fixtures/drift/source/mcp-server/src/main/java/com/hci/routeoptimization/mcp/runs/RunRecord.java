package example.runs;

/** Synthetic fixture: failure codes as string constants. */
public record RunRecord(String id, RunStatus status, String errorCode) {
    /** Lost its heartbeat. */
    public static final String ERROR_ORPHANED = "LOST";
    public static final String ERROR_SHUTDOWN = "STOPPED";

    public static final String OTHER = "not a failure code";
}
