package example.e2e;

/** Synthetic fixture: asserts the listed tool count. */
class McpProtocolTest {
    @Test
    void listsTools() {
        List<McpSchema.Tool> tools = client.listTools().tools();
        assertThat(tools).extracting(McpSchema.Tool::name).hasSize(4)
                .contains("deliver_run");
        assertThat(prompts).hasSize(2);
    }
}
