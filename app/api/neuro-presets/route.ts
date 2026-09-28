import { NextRequest } from "next/server";

type NeuroVaultImage = {
  id?: number;
  name?: string;
  file?: string;
  file_size?: number;
  map_type?: string;
  modality?: string;
  image_modality?: string;
  target_template_image?: string;
  description?: string;
  collection_id?: number;
};

const presets = {
  "mni152-freesurfer-1mm": {
    id: "mni152-freesurfer-1mm",
    label: "MNI152 FreeSurfer Conformed 1 mm",
    source: "NeuroVault",
    imageId: 14245,
    kind: "structural-reference",
    referenceUrl: "https://neurovault.org/images/14245/",
    note: "FSL MNI152 FreeSurfer-conformed reference volume.",
  },
  "harvard-oxford-2mm": {
    id: "harvard-oxford-2mm",
    label: "Harvard–Oxford Cortical + Subcortical 2 mm",
    source: "NeuroVault",
    imageId: 30627,
    kind: "atlas",
    referenceUrl: "https://neurovault.org/images/30627/",
    note: "Cortical and subcortical maximum-probability atlas.",
  },
  "harvard-oxford-sub-1mm": {
    id: "harvard-oxford-sub-1mm",
    label: "Harvard–Oxford Subcortical 1 mm",
    source: "NeuroVault",
    imageId: 1697,
    kind: "atlas",
    referenceUrl: "https://neurovault.org/images/1697/",
    note: "Subcortical maximum-probability atlas.",
  },
  "schaefer-neuromorph-3mm": {
    id: "schaefer-neuromorph-3mm",
    label: "Schaefer + Neuromorphometrics 3 mm",
    source: "NeuroVault",
    imageId: 441983,
    kind: "parcellation",
    referenceUrl: "https://neurovault.org/images/441983/",
    note: "Combined cortical and subcortical parcellation.",
  },
} as const;

type PresetId = keyof typeof presets;

function isPresetId(value: string): value is PresetId {
  return value in presets;
}

function trustedNeuroVaultFile(url: string) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "neurovault.org" ||
        parsed.hostname === "www.neurovault.org")
    );
  } catch {
    return false;
  }
}

async function metadata(imageId: number) {
  const response = await fetch(
    `https://neurovault.org/api/images/${imageId}/`,
    {
      headers: { accept: "application/json" },
      next: { revalidate: 21600 },
    },
  );

  if (!response.ok) {
    throw new Error(`NeuroVault metadata returned ${response.status}`);
  }

  return (await response.json()) as NeuroVaultImage;
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id")?.trim() || "";
  const download = request.nextUrl.searchParams.get("download") === "1";

  if (!id) {
    return Response.json({
      ok: true,
      presets: Object.values(presets).map(
        ({ imageId: _imageId, ...preset }) => preset,
      ),
      fetched_at: new Date().toISOString(),
    });
  }

  if (!isPresetId(id)) {
    return Response.json(
      { ok: false, error: "Unknown neuro preset." },
      { status: 404 },
    );
  }

  const preset = presets[id];

  try {
    const image = await metadata(preset.imageId);

    if (!download) {
      return Response.json({
        ok: true,
        preset: {
          ...preset,
          upstream: {
            id: image.id,
            name: image.name,
            file_size: image.file_size,
            map_type: image.map_type,
            modality: image.modality || image.image_modality,
            target_template_image: image.target_template_image,
            description: image.description,
            collection_id: image.collection_id,
          },
        },
        fetched_at: new Date().toISOString(),
      });
    }

    const file = image.file;
    if (!file || !trustedNeuroVaultFile(file)) {
      return Response.json(
        {
          ok: false,
          error: "Preset metadata does not expose a trusted NIfTI file URL.",
        },
        { status: 502 },
      );
    }

    const upstream = await fetch(file, {
      headers: { accept: "application/octet-stream,application/gzip,*/*" },
      cache: "no-store",
    });

    if (!upstream.ok || !upstream.body) {
      return Response.json(
        {
          ok: false,
          error: `NeuroVault volume returned ${upstream.status}`,
        },
        { status: 502 },
      );
    }

    const headers = new Headers();
    headers.set(
      "content-type",
      upstream.headers.get("content-type") || "application/gzip",
    );
    headers.set(
      "content-disposition",
      `inline; filename="${id}.nii.gz"`,
    );
    headers.set(
      "cache-control",
      "public, max-age=3600, s-maxage=21600, stale-while-revalidate=86400",
    );
    if (upstream.headers.get("content-length")) {
      headers.set(
        "content-length",
        upstream.headers.get("content-length")!,
      );
    }

    return new Response(upstream.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load neuro preset.",
      },
      { status: 502 },
    );
  }
}
