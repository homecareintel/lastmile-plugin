package example.ops;

import java.util.Optional;

/** Synthetic fixture: stable error codes. */
public enum ErrorCode {
    // 400
    INVALID_ARGUMENT(400),
    /** A gadget id that is not well formed. */
    INVALID_GADGET_ID(400),

    // 404
    GADGET_NOT_FOUND(404),

    GADGET_NOT_DELIVERABLE(409),
    INTERNAL_ERROR(500);

    private final int status;

    ErrorCode(int status) {
        this.status = status;
    }

    public static Optional<ErrorCode> find(String name) {
        return Optional.empty();
    }
}
