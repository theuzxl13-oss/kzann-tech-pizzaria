import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Field, MoneyInput, Sheet, useLoad, useToast } from '../components/ui';
import { brl, dateTime, get, post } from '../lib/api';
import { PAYMENT_LABELS } from '../lib/domain';
import { useSession } from './session';

export function CashPage() {
  const current = useLoad(() => get('/api/admin/cash/current'), []);
  const history = useLoad(() => get<any[]>('/api/admin/cash/sessions'), []);
  const [opening, setOpening] = useState<number | null>(0);
  const [movement, setMovement] = useState<null | { type: 'supply' | 'withdrawal'; amount: number | null; reason: string }>(null);
  const [closing, setClosing] = useState<null | { counted: number | null; notes: string }>(null);
  const [report, setReport] = useState<any | null>(null);
  const toast = useToast();

  const run = async (fn: () => Promise<any>, ok: string) => {
    try {
      const r = await fn();
      toast(ok, 'ok');
      current.reload();
      history.reload();
      return r;
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  if (!current.data) return <div className="skeleton" style={{ height: 240 }} />;
  const session = current.data.session;
  const sum = current.data.summary;

  return (
    <>
      {!session ? (
        <div className="card stack" style={{ maxWidth: 460 }}>
          <h3 className="section-title" style={{ margin: 0 }}>Caixa fechado</h3>
          <p className="muted small">Abra o caixa no início do expediente informando o valor em dinheiro (fundo de troco).</p>
          <Field label="Valor inicial em dinheiro"><MoneyInput value={opening} onChange={setOpening} /></Field>
          <button className="btn primary" onClick={() => run(() => post('/api/admin/cash/open', { opening_cents: opening ?? 0 }), 'Caixa aberto')}>Abrir caixa</button>
        </div>
      ) : (
        <>
          <div className="card row wrap between">
            <div>
              <div className="bold">Caixa aberto desde {dateTime(session.opened_at)}</div>
              <div className="small muted">por {session.opened_by_name} · fundo de troco {brl(session.opening_cents)}</div>
            </div>
            <div className="row wrap">
              <button className="btn ghost" onClick={() => setMovement({ type: 'supply', amount: null, reason: '' })}>+ Suprimento</button>
              <button className="btn ghost" onClick={() => setMovement({ type: 'withdrawal', amount: null, reason: '' })}>− Sangria</button>
              <button className="btn dark" onClick={() => setClosing({ counted: null, notes: '' })}>Fechar caixa</button>
            </div>
          </div>
          <SummaryCards sum={sum} />
        </>
      )}

      <div className="card" style={{ padding: 0 }}>
        <h3 className="section-title" style={{ padding: '14px 16px 0' }}>Fechamentos anteriores</h3>
        <div className="table-wrap" style={{ boxShadow: 'none' }}>
          <table className="table">
            <thead><tr><th>Abertura</th><th className="hide-mobile">Fechamento</th><th>Esperado</th><th>Contado</th><th>Diferença</th></tr></thead>
            <tbody>
              {(history.data ?? []).filter((s) => s.status === 'closed').map((s) => {
                const diff = (s.counted_cents ?? 0) - (s.expected_cents ?? 0);
                return (
                  <tr key={s.id} className="click" onClick={async () => setReport(await get(`/api/admin/cash/sessions/${s.id}`))}>
                    <td className="small">{dateTime(s.opened_at)}<div className="tiny muted">{s.opened_by_name}</div></td>
                    <td className="small hide-mobile">{dateTime(s.closed_at)}<div className="tiny muted">{s.closed_by_name}</div></td>
                    <td>{brl(s.expected_cents)}</td>
                    <td>{brl(s.counted_cents)}</td>
                    <td className="bold" style={{ color: diff === 0 ? 'var(--ok)' : 'var(--danger)' }}>{diff > 0 ? '+' : ''}{brl(diff)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {movement && (
        <Sheet
          title={movement.type === 'supply' ? 'Suprimento (entrada de dinheiro)' : 'Sangria (retirada de dinheiro)'}
          onClose={() => setMovement(null)}
          footer={
            <button
              className="btn primary block"
              disabled={!movement.amount || movement.reason.trim().length < 2}
              onClick={async () => {
                await run(() => post('/api/admin/cash/movements', { type: movement.type, amount_cents: movement.amount, reason: movement.reason }), 'Movimentação registrada');
                setMovement(null);
              }}
            >
              Registrar
            </button>
          }
        >
          <Field label="Valor"><MoneyInput value={movement.amount} onChange={(v) => setMovement({ ...movement, amount: v })} /></Field>
          <Field label="Motivo"><input className="input" value={movement.reason} onChange={(e) => setMovement({ ...movement, reason: e.target.value })} placeholder="Ex.: pagamento do motoboy" /></Field>
        </Sheet>
      )}

      {closing && (
        <Sheet
          title="Fechar caixa"
          onClose={() => setClosing(null)}
          footer={
            <button
              className="btn dark block"
              disabled={closing.counted === null}
              onClick={async () => {
                const r = await run(() => post('/api/admin/cash/close', { counted_cents: closing.counted, notes: closing.notes }), 'Caixa fechado');
                setClosing(null);
                if (r) setReport(r);
              }}
            >
              Confirmar fechamento
            </button>
          }
        >
          <p className="muted small">Conte o dinheiro da gaveta e informe o valor. O sistema compara com o esperado.</p>
          <div className="summary-line"><span>Dinheiro esperado</span><b>{brl(sum.expected_cash_cents)}</b></div>
          <Field label="Dinheiro contado"><MoneyInput value={closing.counted} onChange={(v) => setClosing({ ...closing, counted: v })} /></Field>
          {closing.counted !== null && (
            <div className={`alert ${closing.counted === sum.expected_cash_cents ? 'ok' : 'danger'}`}>
              Diferença: {brl(closing.counted - sum.expected_cash_cents)}
            </div>
          )}
          <Field label="Observações"><textarea className="input" value={closing.notes} onChange={(e) => setClosing({ ...closing, notes: e.target.value })} /></Field>
        </Sheet>
      )}

      {report && <CashReport data={report} onClose={() => setReport(null)} />}
    </>
  );
}

function SummaryCards({ sum }: { sum: any }) {
  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <div className="card stack tight">
        <h3 className="section-title" style={{ margin: 0 }}>Recebimentos do turno</h3>
        {sum.by_method.length === 0 && <p className="muted small">Nenhum recebimento ainda.</p>}
        {sum.by_method.map((m: any) => (
          <div key={m.payment_method} className="summary-line">
            <span>{PAYMENT_LABELS[m.payment_method as keyof typeof PAYMENT_LABELS]} <span className="muted small">({m.orders})</span></span>
            <b>{brl(m.total_cents)}</b>
          </div>
        ))}
        <div className="summary-line total"><span>Total recebido</span><span>{brl(sum.total_received_cents)}</span></div>
        {sum.cancelled.orders > 0 && <p className="small muted">{sum.cancelled.orders} cancelado(s) · {brl(sum.cancelled.total_cents)}</p>}
        {(sum.refunds ?? []).length > 0 && (
          <div className="stack tight">
            <hr className="divider" />
            <div className="small bold">Cancelados após pagamento</div>
            {sum.refunds.map((r: any) => (
              <div key={r.id} className="small row between">
                <span>#{r.number} · {PAYMENT_LABELS[r.payment_method as keyof typeof PAYMENT_LABELS]}</span>
                <span className={r.payment_status === 'refund_pending' ? 'bold' : 'muted'} style={r.payment_status === 'refund_pending' ? { color: 'var(--danger)' } : undefined}>
                  {brl(r.total_cents)} · {r.payment_status === 'refund_pending' ? 'a devolver' : 'devolvido'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card stack tight">
        <h3 className="section-title" style={{ margin: 0 }}>Gaveta (dinheiro)</h3>
        <div className="summary-line"><span>Suprimentos</span><span>+ {brl(sum.supplies_cents)}</span></div>
        <div className="summary-line"><span>Sangrias</span><span>− {brl(sum.withdrawals_cents)}</span></div>
        {sum.cash_to_return_cents > 0 && (
          <div className="summary-line" style={{ color: 'var(--danger)' }}><span>Dinheiro a devolver (incluso)</span><span>{brl(sum.cash_to_return_cents)}</span></div>
        )}
        <div className="summary-line total"><span>Esperado na gaveta</span><span>{brl(sum.expected_cash_cents)}</span></div>
        {sum.movements.map((m: any) => (
          <div key={m.id} className="small muted row between">
            <span>{m.type === 'supply' ? '+' : '−'} {brl(m.amount_cents)} · {m.reason}</span>
            <span>{dateTime(m.created_at)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CashReport({ data, onClose }: { data: any; onClose: () => void }) {
  const { me } = useSession();
  const s = data.session;
  const sum = data.summary;
  const diff = (s.counted_cents ?? 0) - (s.expected_cents ?? sum.expected_cash_cents);
  return (
    <Sheet wide title="Relatório de fechamento" onClose={onClose} footer={<button className="btn primary block" onClick={() => window.print()}>🖨 Imprimir</button>}>
      <p className="small">Abertura {dateTime(s.opened_at)} · Fechamento {s.closed_at ? dateTime(s.closed_at) : '—'}</p>
      <SummaryCards sum={sum} />
      <div className="card flat row between">
        <span>Contado: <b>{brl(s.counted_cents)}</b></span>
        <span className="bold" style={{ color: diff === 0 ? 'var(--ok)' : 'var(--danger)' }}>Diferença: {brl(diff)}</span>
      </div>
      {s.notes && <p className="small">Obs.: {s.notes}</p>}
      {createPortal(
        <div className="print-area print-only">
          <h2>{me?.tenant?.name}</h2>
          <p className="pc">FECHAMENTO DE CAIXA</p>
          <hr />
          <div>Abertura: {dateTime(s.opened_at)} ({s.opened_by_name})</div>
          <div>Fechamento: {s.closed_at ? dateTime(s.closed_at) : '—'} ({s.closed_by_name ?? ''})</div>
          <hr />
          {sum.by_method.map((m: any) => (
            <div key={m.payment_method} className="pl"><span>{PAYMENT_LABELS[m.payment_method as keyof typeof PAYMENT_LABELS]} ({m.orders})</span><span>{brl(m.total_cents)}</span></div>
          ))}
          <div className="pl"><strong>Total recebido</strong><strong>{brl(sum.total_received_cents)}</strong></div>
          <hr />
          <div className="pl"><span>Fundo de troco</span><span>{brl(s.opening_cents)}</span></div>
          <div className="pl"><span>Suprimentos</span><span>{brl(sum.supplies_cents)}</span></div>
          <div className="pl"><span>Sangrias</span><span>-{brl(sum.withdrawals_cents)}</span></div>
          <div className="pl"><span>Esperado</span><span>{brl(sum.expected_cash_cents)}</span></div>
          <div className="pl"><span>Contado</span><span>{brl(s.counted_cents)}</span></div>
          <div className="pl"><strong>Diferença</strong><strong>{brl(diff)}</strong></div>
          <hr />
          <p className="pc">Kzann Tech</p>
        </div>,
        document.body,
      )}
    </Sheet>
  );
}
