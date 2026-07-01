// app/pro/finance/_components/FinanceExpensesPanel.tsx
//
// The Finance "Expenses" sub-tab: total tracked, an add/edit form, the tracked
// expense list, and the (v1.5) supply-order import stub. Mutations are handled
// by the parent (which refetches the month); this panel owns only form UI state.
'use client'

import { useState, type FormEvent } from 'react'

import type {
  ProFinanceCategoryInfo,
  ProFinanceExpenseItem,
} from '@/lib/finance/proFinanceSummary'

import { PencilIcon, PlusIcon, TrashIcon } from './icons'

export type ExpenseFormPayload = {
  category: string
  amount: string
  label: string
  date: string
  notes: string
}

export type ExpenseMutationResult = { ok: boolean; error?: string }

type FinanceExpensesPanelProps = {
  expenses: ProFinanceExpenseItem[]
  expenseTotalLabel: string
  categories: ProFinanceCategoryInfo[]
  onCreate: (payload: ExpenseFormPayload) => Promise<ExpenseMutationResult>
  onUpdate: (
    id: string,
    payload: ExpenseFormPayload,
  ) => Promise<ExpenseMutationResult>
  onDelete: (id: string) => Promise<void>
}

function todayInputValue(): string {
  // YYYY-MM-DD for the native date input's default. UTC slice is fine — it's an
  // editable default, and toISOString is not a locale/Intl format (guard-safe).
  return new Date().toISOString().slice(0, 10)
}

export default function FinanceExpensesPanel({
  expenses,
  expenseTotalLabel,
  categories,
  onCreate,
  onUpdate,
  onDelete,
}: FinanceExpensesPanelProps) {
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  function openCreate() {
    setEditingId(null)
    setFormOpen(true)
  }

  function openEdit(expense: ProFinanceExpenseItem) {
    setEditingId(expense.id)
    setFormOpen(true)
  }

  const editingExpense =
    editingId != null
      ? expenses.find((expense) => expense.id === editingId) ?? null
      : null

  return (
    <div>
      <div className="brand-pro-finance-expenses-head">
        <div>
          <div className="brand-cap brand-pro-finance-total-label">
            TOTAL TRACKED
          </div>
          <div className="brand-pro-finance-total-value">
            {expenseTotalLabel}
          </div>
        </div>

        {!formOpen && (
          <button
            type="button"
            className="brand-pro-finance-add-btn brand-focus"
            onClick={openCreate}
          >
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <PlusIcon /> Add Expense
            </span>
          </button>
        )}
      </div>

      {formOpen && (
        <ExpenseForm
          key={editingId ?? 'new'}
          categories={categories}
          editing={editingExpense}
          onCancel={() => setFormOpen(false)}
          onSubmit={async (payload) => {
            const result = editingExpense
              ? await onUpdate(editingExpense.id, payload)
              : await onCreate(payload)
            if (result.ok) setFormOpen(false)
            return result
          }}
        />
      )}

      {expenses.length > 0 ? (
        <div className="brand-pro-finance-expense-list">
          {expenses.map((expense) => (
            <ExpenseRow
              key={expense.id}
              expense={expense}
              onEdit={() => openEdit(expense)}
              onDelete={() => onDelete(expense.id)}
            />
          ))}
        </div>
      ) : (
        <div className="brand-pro-finance-empty">
          No expenses tracked for this month yet. Add your first one to start
          building your write-offs.
        </div>
      )}

      <ImportStub />
    </div>
  )
}

function ExpenseRow({
  expense,
  onEdit,
  onDelete,
}: {
  expense: ProFinanceExpenseItem
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <article className="brand-pro-finance-expense-card">
      <div className="brand-pro-finance-expense-main">
        <div className="brand-pro-finance-expense-label">{expense.label}</div>
        <div className="brand-pro-finance-expense-meta">
          <span
            className="brand-pro-finance-expense-cat"
            data-risk={expense.categoryRisk}
          >
            {expense.categoryLabel}
          </span>
          <span aria-hidden="true" className="brand-pro-finance-expense-date">
            ·
          </span>
          <span className="brand-pro-finance-expense-date">
            {expense.dateLabel}
          </span>
        </div>
      </div>

      <div className="brand-pro-finance-expense-amount">
        {expense.amountLabel}
      </div>

      <div className="brand-pro-finance-expense-actions">
        <button
          type="button"
          className="brand-pro-finance-icon-btn brand-focus"
          onClick={onEdit}
          aria-label={`Edit ${expense.label}`}
        >
          <PencilIcon />
        </button>
        <button
          type="button"
          className="brand-pro-finance-icon-btn brand-focus"
          data-danger="true"
          onClick={onDelete}
          aria-label={`Delete ${expense.label}`}
        >
          <TrashIcon />
        </button>
      </div>
    </article>
  )
}

function ExpenseForm({
  categories,
  editing,
  onSubmit,
  onCancel,
}: {
  categories: ProFinanceCategoryInfo[]
  editing: ProFinanceExpenseItem | null
  onSubmit: (payload: ExpenseFormPayload) => Promise<ExpenseMutationResult>
  onCancel: () => void
}) {
  const [category, setCategory] = useState(
    editing?.category ?? categories[0]?.id ?? '',
  )
  const [amount, setAmount] = useState(
    editing ? (editing.amountCents / 100).toFixed(2) : '',
  )
  const [label, setLabel] = useState(editing?.label ?? '')
  const [date, setDate] = useState(
    editing?.spentAtIso?.slice(0, 10) ?? todayInputValue(),
  )
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit =
    category !== '' && amount.trim() !== '' && label.trim() !== '' && date !== ''

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit || submitting) return

    setSubmitting(true)
    setError(null)

    const result = await onSubmit({ category, amount, label, date, notes })

    if (!result.ok) {
      setError(result.error ?? 'Could not save this expense.')
      setSubmitting(false)
    }
  }

  return (
    <form className="brand-pro-finance-form" onSubmit={handleSubmit}>
      <div className="brand-pro-finance-form-grid">
        <label className="brand-pro-finance-form-field">
          <span className="brand-pro-finance-form-label">Category</span>
          <select
            className="brand-pro-finance-select"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {categories.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="brand-pro-finance-form-field">
          <span className="brand-pro-finance-form-label">Amount</span>
          <input
            className="brand-pro-finance-input"
            type="text"
            inputMode="decimal"
            placeholder="50 or 49.99"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>

        <label className="brand-pro-finance-form-field" data-span="full">
          <span className="brand-pro-finance-form-label">Description</span>
          <input
            className="brand-pro-finance-input"
            type="text"
            placeholder="e.g. CosmoProf order"
            value={label}
            maxLength={200}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>

        <label className="brand-pro-finance-form-field">
          <span className="brand-pro-finance-form-label">Date</span>
          <input
            className="brand-pro-finance-input"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>

        <label className="brand-pro-finance-form-field">
          <span className="brand-pro-finance-form-label">Notes (optional)</span>
          <input
            className="brand-pro-finance-input"
            type="text"
            placeholder="Anything to remember"
            value={notes}
            maxLength={1000}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
      </div>

      {error && <div className="brand-pro-finance-form-error">{error}</div>}

      <div className="brand-pro-finance-form-actions">
        <button
          type="button"
          className="brand-pro-finance-btn brand-focus"
          data-variant="ghost"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="brand-pro-finance-btn brand-focus"
          data-variant="primary"
          disabled={!canSubmit || submitting}
        >
          {submitting ? 'Saving…' : editing ? 'Save changes' : 'Add expense'}
        </button>
      </div>
    </form>
  )
}

function ImportStub() {
  return (
    <div className="brand-pro-finance-import-card">
      <div className="brand-pro-finance-import-title">
        Import from CosmoProf or Salon Centric
      </div>
      <p className="brand-pro-finance-import-body">
        Connect your account to auto-import order history as expenses.
      </p>
      <button
        type="button"
        className="brand-pro-finance-btn brand-focus"
        data-variant="ghost"
        disabled
      >
        Connect account — coming soon
      </button>
    </div>
  )
}
