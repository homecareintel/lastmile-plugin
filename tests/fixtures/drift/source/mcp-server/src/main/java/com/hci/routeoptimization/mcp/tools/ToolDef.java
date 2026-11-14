package example.tools;

/** Synthetic fixture: not a tool class (its name does not end in Tools). */
public final class ToolDef {
    public static <A> Builder<A> builder(String name, Class<A> arguments) {
        return new Builder<>(name, arguments);
    }
}
