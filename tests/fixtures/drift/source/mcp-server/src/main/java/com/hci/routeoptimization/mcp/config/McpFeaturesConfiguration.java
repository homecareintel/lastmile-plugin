package example.config;

import java.util.ArrayList;
import java.util.List;

/** Synthetic fixture: registers the tool classes and one prompt per checklist domain. */
public class McpFeaturesConfiguration {
    ToolRegistry toolRegistry(Catalog catalog, Settings settings, Delivery delivery) {
        return new ToolRegistry(List.of(
                new SettingsTools(catalog, settings.topics().stream().map(Topic::name).toList()).tools(),
                // new RetiredTools(catalog).tools(),
                new GadgetTools(catalog).tools(),
                new DeliveryTools(delivery).tools()), null);
    }

    List<PromptSpec> prompts() {
        List<PromptSpec> out = new ArrayList<>();
        for (String domain : SettingsTools.DOMAINS) {
            Prompt prompt = new McpSchema.Prompt("domain-checklist-" + domain,
                    "Interview: " + domain, "Walk through the " + domain + " checklist.", List.of());
            out.add(new PromptSpec(prompt));
        }
        return out;
    }
}
