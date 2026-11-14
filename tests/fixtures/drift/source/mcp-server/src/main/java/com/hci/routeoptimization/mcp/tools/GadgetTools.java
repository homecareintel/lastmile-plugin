package example.tools;

import java.util.List;

/** Synthetic fixture: two tools, a nested describe, a multi-name required. */
public final class GadgetTools {
    public List<ToolDef> tools() {
        return List.of(countGadgets(), mapGadgets());
    }

    ToolDef countGadgets() {
        return ToolDef.builder("count_gadgets", CountRequest.class)
                .title("Count gadgets")
                .description("Counts gadgets in a bin.")
                .arg("bin_id", "The bin.")
                .arg("kind", "Only gadgets of this kind.", Kinds.names())
                .arg("limit", "At most (default " + 20 + ").")
                .required("bin_id", "kind")
                .output(Count.class)
                .hints(true, false, true, false)
                .handler((caller, req) -> Result.of("counted", List.of(), count(req)))
                .build();
    }

    ToolDef mapGadgets() {
        return ToolDef.builder("map_gadgets", MapRequest.class)
                .title("Map gadget columns")
                .description("Applies a column map.")
                .arg("bin_id", "From count_gadgets.")
                .arg("mapping", "The confirmed map.")
                .describe("mapping.columns[].role", "What the column means.")
                .describe("note", "A free-text note.")
                .required("bin_id")
                .required("mapping")
                .output(MapResult.class)
                .hints(false, false, true, true)
                .handler((caller, req) -> Result.of("mapped", List.of(), Mapper.builder().with(req).build()))
                .build();
    }
}
