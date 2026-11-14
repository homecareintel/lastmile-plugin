package example.tools;

import java.util.List;

/*
 * Synthetic fixture. Block comment decoy: .hints(true, false, true, false) and .arg("ghost", "x")
 */
public final class DeliveryTools {
    public List<ToolDef> tools() {
        return List.of(deliverRun());
    }

    ToolDef deliverRun() {
        return ToolDef.builder("deliver_run", DeliverRequest.class)
                .title("Deliver a run")
                .description("Publish a finished run; answers GADGET_NOT_DELIVERABLE when it cannot.")
                .arg("run_id", "A finished run.")
                .arg("result_id", "The id the customer sees (default: the run id).")
                .required("run_id")
                .output(Delivery.class)
                .hints(false, true, false, true)
                .handler((caller, req) -> {
                    Delivery d = deliver(caller, req);
                    return Result.of("Delivered " + d.id() + ".", List.of("runId"), d);
                })
                .build();
    }
}
