package example.ops;

/** Synthetic fixture: the compile profile states are a nested enum among others. */
public final class RunOps {
    public enum Kind { SOLVE, PREVIEW }

    public record Compiled(String id, ProfileState state) {
    }

    public enum ProfileState {
        /** An approved version. */
        SIGNED_OFF,
        EMPTY_DEFAULT
    }

    public void run() {
    }
}
