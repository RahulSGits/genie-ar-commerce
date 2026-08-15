'use client'

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useFormStatus } from 'react-dom'
import { Boxes, Layers, Plus, Search, Trash2, X } from 'lucide-react'
import {
  Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle,
  EmptyState, Field, Input, Separator, Switch, Textarea,
} from '@/components/ui'
import {
  createCollectionAction, deleteCollectionAction, setCollectionProductsAction,
  updateCollectionAction,
} from '@/lib/actions/genie'
import { formatMoney, type CurrencyCode } from '@/utils/money'
import type { ActionResult } from '@/lib/auth/errors'
import type { Collection } from '@/lib/db/repositories/generation'
import { cn } from '@/lib/utils'

export type CollectionProductOption = {
  id: string
  name: string
  imageUrl: string | null
  priceMinor: number | null
  currency: CurrencyCode
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      <Plus className="size-4" aria-hidden />
      {pending ? 'Creating…' : 'Create collection'}
    </Button>
  )
}

export default function CollectionsManager({
  collections,
  products,
  memberIds,
  itemPlural,
}: {
  collections: Collection[]
  products: CollectionProductOption[]
  /** Collection id → the product ids currently in it. */
  memberIds: Record<string, string[]>
  itemPlural: string
}) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(
    createCollectionAction,
    null,
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [pending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const noun = itemPlural.toLowerCase()
  const selected = collections.find((c) => c.id === selectedId) ?? null
  const saved = selectedId ? (memberIds[selectedId] ?? []) : []
  const savedKey = saved.join('|')

  useEffect(() => {
    if (state?.ok) formRef.current?.reset()
  }, [state])

  // The panel edits a copy so a half-finished selection is never written. It
  // re-syncs whenever the server sends back a different membership — after a
  // save, or after picking another collection.
  useEffect(() => {
    setDraft(new Set(savedKey ? savedKey.split('|') : []))
  }, [selectedId, savedKey])

  // A collection deleted in another tab would otherwise leave the panel open on
  // something that no longer exists.
  useEffect(() => {
    if (selectedId && !collections.some((c) => c.id === selectedId)) setSelectedId(null)
  }, [collections, selectedId])

  const dirty = draft.size !== saved.length || saved.some((id) => !draft.has(id))

  const visible = query.trim()
    ? products.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    : products

  function handleSave() {
    if (!selectedId) return
    // Product order decides sort order inside the collection, so the catalogue
    // order is sent rather than the order boxes happened to get ticked in.
    const ids = products.filter((p) => draft.has(p.id)).map((p) => p.id)
    startTransition(() => {
      void setCollectionProductsAction(selectedId, ids)
    })
  }

  function handleDelete(collection: Collection) {
    if (
      !window.confirm(
        `Delete "${collection.name}"?\n\nThe ${noun} in it stay in your catalogue — only the grouping goes.`,
      )
    ) {
      return
    }
    startTransition(() => {
      void deleteCollectionAction(collection.id)
    })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New collection</CardTitle>
          <CardDescription>
            A name is enough to start. You choose which {noun} belong to it next.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form ref={formRef} action={action} className="space-y-4">
            {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
            {state?.ok && (
              <Alert variant="success">Collection created. Open it to add {noun}.</Alert>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="name" required hint="What customers will see, e.g. Winter menu.">
                <Input
                  ref={nameRef}
                  id="name"
                  name="name"
                  required
                  maxLength={80}
                  placeholder="Winter menu"
                />
              </Field>

              <Field label="Description" htmlFor="description" hint="Optional. One line of context.">
                <Textarea
                  id="description"
                  name="description"
                  rows={2}
                  maxLength={300}
                  placeholder="Seasonal dishes, served until February."
                />
              </Field>
            </div>

            <SubmitButton />
          </form>
        </CardContent>
      </Card>

      {collections.length === 0 ? (
        <EmptyState
          icon={<Layers />}
          title="No collections yet"
          description={`Collections let you show a curated set of ${noun} — a lunch menu, a festive drop, a single shelf — without touching the rest of your catalogue.`}
          action={
            <Button size="sm" onClick={() => nameRef.current?.focus()}>
              <Plus className="size-4" aria-hidden />
              Create your first collection
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className={cn('grid gap-4 sm:grid-cols-2', selected ? 'lg:col-span-2' : 'lg:col-span-3')}>
            {collections.map((collection) => (
              <CollectionCard
                key={collection.id}
                collection={collection}
                noun={noun}
                isSelected={collection.id === selectedId}
                disabled={pending}
                onSelect={() => setSelectedId(collection.id === selectedId ? null : collection.id)}
                onDelete={() => handleDelete(collection)}
              />
            ))}
          </div>

          {selected && (
            <Card className="lg:sticky lg:top-6 lg:h-fit">
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="truncate text-base">{selected.name}</CardTitle>
                  <CardDescription>
                    Tick every {itemPlural.toLowerCase().replace(/s$/, '')} that belongs here.
                  </CardDescription>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Close editor"
                  onClick={() => setSelectedId(null)}
                >
                  <X className="size-4" aria-hidden />
                </Button>
              </CardHeader>

              <CardContent className="space-y-3">
                {products.length === 0 ? (
                  <EmptyState
                    icon={<Boxes />}
                    title={`No ${noun} to add`}
                    description={`A collection groups things you already sell. Add ${noun} to your catalogue first.`}
                    action={
                      <Button asChild size="sm">
                        <Link href="/dashboard/products/new">Add your first product</Link>
                      </Button>
                    }
                    className="border-0"
                  />
                ) : (
                  <>
                    <div className="relative">
                      <Search
                        className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                        aria-hidden
                      />
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={`Search ${noun}`}
                        aria-label={`Search ${noun}`}
                        className="pl-9"
                      />
                    </div>

                    {visible.length === 0 ? (
                      <p className="text-muted-foreground py-6 text-center text-sm">
                        Nothing matches “{query}”.
                      </p>
                    ) : (
                      <ul className="max-h-[26rem] space-y-1 overflow-y-auto pr-1">
                        {visible.map((product) => {
                          const checked = draft.has(product.id)
                          return (
                            <li key={product.id}>
                              <label
                                className={cn(
                                  'flex cursor-pointer items-center gap-3 rounded-lg border p-2 transition-colors',
                                  checked ? 'border-primary/40 bg-primary/5' : 'hover:bg-accent/40',
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) =>
                                    setDraft((prev) => {
                                      const next = new Set(prev)
                                      if (e.target.checked) next.add(product.id)
                                      else next.delete(product.id)
                                      return next
                                    })
                                  }
                                  className="accent-primary size-4 shrink-0"
                                />
                                {product.imageUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={product.imageUrl}
                                    alt=""
                                    className="bg-muted size-9 shrink-0 rounded-md object-cover"
                                  />
                                ) : (
                                  <span className="bg-muted grid size-9 shrink-0 place-items-center rounded-md">
                                    <Boxes className="text-muted-foreground/50 size-4" aria-hidden />
                                  </span>
                                )}
                                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                                  {product.name}
                                </span>
                                {product.priceMinor !== null && (
                                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                                    {formatMoney({
                                      amount: product.priceMinor,
                                      currency: product.currency,
                                    })}
                                  </span>
                                )}
                              </label>
                            </li>
                          )
                        })}
                      </ul>
                    )}

                    <Separator />

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-muted-foreground text-xs tabular-nums">
                        {draft.size} of {products.length} selected
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!dirty || pending}
                          onClick={() => setDraft(new Set(saved))}
                        >
                          Reset
                        </Button>
                        <Button size="sm" disabled={!dirty || pending} onClick={handleSave}>
                          {pending ? 'Saving…' : 'Save selection'}
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

function CollectionCard({
  collection,
  noun,
  isSelected,
  disabled,
  onSelect,
  onDelete,
}: {
  collection: Collection
  noun: string
  isSelected: boolean
  disabled: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const [published, setPublished] = useState(collection.isPublished)
  const [pending, startTransition] = useTransition()

  // Server revalidation is the source of truth; the local flag only smooths the
  // gap between the tap and the round trip.
  useEffect(() => setPublished(collection.isPublished), [collection.isPublished])

  return (
    <Card className={cn('flex flex-col', isSelected && 'border-primary ring-primary/20 ring-[3px]')}>
      <CardContent className="flex flex-1 flex-col gap-3 pt-5">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={onSelect}
            aria-expanded={isSelected}
            className="min-w-0 flex-1 text-left"
          >
            <p className="truncate font-medium">{collection.name}</p>
            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-sm">
              {collection.description || 'No description yet.'}
            </p>
          </button>
          <Switch
            checked={published}
            disabled={pending}
            aria-label={`Publish ${collection.name}`}
            onCheckedChange={(v) => {
              setPublished(v)
              startTransition(() => {
                void updateCollectionAction(collection.id, { isPublished: v })
              })
            }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="tabular-nums">
            {collection.productCount} {noun}
          </Badge>
          <Badge variant={published ? 'success' : 'muted'}>{published ? 'Published' : 'Draft'}</Badge>
        </div>

        <div className="mt-auto flex items-center gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={onSelect}>
            <Layers className="size-3.5" aria-hidden />
            {isSelected ? 'Close' : `Edit ${noun}`}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            disabled={disabled || pending}
            className="text-muted-foreground hover:text-destructive ml-auto"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
