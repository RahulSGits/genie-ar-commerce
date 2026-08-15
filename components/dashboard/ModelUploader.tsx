'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { FileBox, Info, UploadCloud } from 'lucide-react'
import {
  Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input,
} from '@/components/ui'
import { uploadModelAction } from '@/lib/actions/dashboard'
import { formatBytes } from '@/lib/utils'
import type { ActionResult } from '@/lib/auth/errors'

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={disabled || pending} className="w-full sm:w-auto">
      <UploadCloud className="size-4" aria-hidden />
      {pending ? 'Uploading…' : 'Upload model'}
    </Button>
  )
}

/**
 * Upload form for 3D assets.
 *
 * The picked file is echoed back with its size before submit because a 20 MB
 * model over a phone connection is a minute of silence otherwise — the operator
 * should be able to reconsider before that minute starts, not after it.
 */
export default function ModelUploader() {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(
    uploadModelAction,
    null,
  )
  const [picked, setPicked] = useState<{ name: string; size: number } | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset()
      setPicked(null)
    }
  }, [state])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Upload a 3D model</CardTitle>
        <CardDescription>
          GLB is the format that works everywhere. GLTF and USDZ are accepted too.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <form ref={formRef} action={action} className="space-y-4">
          {state && !state.ok && <Alert variant="destructive">{state.error}</Alert>}
          {state?.ok && <Alert variant="success">Model uploaded and ready to attach.</Alert>}

          <Field
            label="Model file"
            htmlFor="file"
            required
            hint="Up to 25 MB. Under 5 MB loads comfortably on mobile data."
          >
            <Input
              id="file"
              name="file"
              type="file"
              accept=".glb,.gltf,.usdz"
              required
              className="file:text-foreground h-auto py-2 file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium"
              onChange={(e) => {
                const f = e.target.files?.[0]
                setPicked(f ? { name: f.name, size: f.size } : null)
              }}
            />
          </Field>

          {picked && (
            <div className="bg-muted/40 flex items-center gap-3 rounded-lg border px-3 py-2.5">
              <FileBox className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{picked.name}</span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {formatBytes(picked.size)}
              </span>
            </div>
          )}

          <Field
            label="Name"
            htmlFor="name"
            hint="Leave blank to use the filename."
          >
            <Input id="name" name="name" maxLength={120} placeholder="Paneer Tikka" />
          </Field>

          <SubmitButton disabled={!picked} />
        </form>

        <div className="bg-muted/40 space-y-2 rounded-lg border p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Info className="text-muted-foreground size-4" aria-hidden />
            How to get a 3D model
          </p>
          <ol className="text-muted-foreground list-decimal space-y-1.5 pl-5 text-sm">
            <li>Photograph the item from every angle on a plain surface, even lighting.</li>
            <li>Model it, or photogrammetry-scan the photos into a mesh.</li>
            <li>Optimise in Blender — decimate the mesh, bake textures to one 2K map.</li>
            <li>Export GLB with Draco compression on.</li>
            <li>Keep it under 5 MB so it loads before a customer gives up.</li>
            <li>
              Export at real-world size: glTF units are <strong>metres</strong>, so a 30 cm plate
              must measure 0.3 — a mis-scaled model appears the size of a car in AR.
            </li>
          </ol>
        </div>
      </CardContent>
    </Card>
  )
}
