package example.tools;

import java.util.List;

/** Synthetic fixture: a settings-style class that also owns the checklist domains. */
public final class SettingsTools {
    public static final List<String> DOMAINS = List.of("alpha-care", "beta-fuel");

    public List<ToolDef> tools() {
        return List.of(describeWidgets());
    }

    // a decoy in a comment: ToolDef.builder("commented_out", Object.class).hints(true, true, true, true)
    ToolDef describeWidgets() {
        return ToolDef.builder("describe_widgets", WidgetRequest.class)
                .title("Describe " + "widgets")
                .description("Look up widgets. Say \"widget\" when you mean one. "
                        + "Paged with offset.")
                .arg("mode", "Widget mode.", List.of("small", "large"))
                .arg("offset", "Character offset, e.g. \"0\".")
                .required("mode")
                .output(WidgetDescription.class)
                .hints(true, false, true, false)
                .handler((caller, req) -> Result.of("ok (" + req.mode() + ")", List.of(), null))
                .build();
    }
}
