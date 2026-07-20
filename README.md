# lolo

通用 MCP Agent 测试客户端。后端使用 OpenAI-compatible Chat Completions API，动态发现并调用标准 MCP 工具；前端使用 React + Vite。

## 本地启动

```cmd
copy .env.example .env
npm.cmd install
npm.cmd run dev
```

- 前端：`http://127.0.0.1:5173`
- 后端健康检查：`http://127.0.0.1:3000/health`
- MCP 连接检查：`http://127.0.0.1:3000/health/mcp`

也可以分别运行 `npm.cmd run dev:server` 和 `npm.cmd run dev:ui`。

## MCP 容错

- `tools/list` 失败后会清理旧 Session、重新连接并重试一次。
- 工具调用只在 Session 明确失效，或工具声明为只读/幂等时自动重放。
- MCP 不可用或没有工具时，lolo 会继续普通对话，不会中断自身服务。
- 需要外部信息或操作但没有可用工具时，lolo 只说明暂时无法完成，不得编造外部结果或暴露内部实现。

## 查看发送给 LLM 的完整请求

在 `.env` 中启用：

```env
LOLO_DEBUG_LLM=true
```

重启 lolo 后端并打开浏览器开发者工具。Console 中的 `[lolo] LLM request` 分组会显示每一轮实际发送的 `model`、`messages`、`tools`、`tool_choice` 和 `stream`。日志不包含 API Key，但可能包含对话、地址和订单数据，仅建议在本地调试时启用。

## 验证

```cmd
npm.cmd test
npm.cmd run lint
npm.cmd run build
```
