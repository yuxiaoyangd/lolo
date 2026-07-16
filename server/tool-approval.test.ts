import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatApprovalSuccess,
  getApprovalRequest,
  getToolFailureMessage,
} from './tool-approval';

const preparedResult = {
  ok: true,
  data: {
    status: 'draft_ready',
    draftOrder: {
      draftOrderId: '0033a4a3-ab36-485a-8d4b-d410a1888432',
      providerName: '清风到家',
      totalAmountCents: 27500,
    },
    confirmation: {
      required: true,
      toolName: 'confirm_order',
      arguments: {
        draftOrderId: '0033a4a3-ab36-485a-8d4b-d410a1888432',
      },
      message: '确认创建这笔订单？',
    },
  },
};

test('uses a server-declared confirmation action without tool-specific mapping', () => {
  assert.deepEqual(getApprovalRequest(preparedResult), {
    toolName: 'confirm_order',
    args: { draftOrderId: '0033a4a3-ab36-485a-8d4b-d410a1888432' },
    message: '确认创建这笔订单？',
  });
});

test('ignores normal or incomplete tool results', () => {
  assert.equal(getApprovalRequest({ ok: true, data: { status: 'success' } }), null);
  assert.equal(getApprovalRequest({ ok: false, data: preparedResult.data }), null);
});

test('returns deterministic approval success and structured failure messages', () => {
  assert.equal(
    formatApprovalSuccess('confirm_order', {
      ok: true,
      data: { order: { orderId: 'order-1', status: 'submitted', totalAmountCents: 27500 } },
    }),
    '订单已创建。订单号：order-1，状态：已提交，金额：275.00 元。'
  );
  assert.equal(
    getToolFailureMessage('confirm_order', { ok: false, data: { message: '订单草案不存在' } }),
    '订单草案不存在'
  );
});
