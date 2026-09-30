import { useState } from "react";
import { Package, ZoomIn } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function ProductImage({ src, alt, className = "", loading = "lazy" }: { src?: string; alt: string; className?: string; loading?: "lazy" | "eager" }) {
  const [failed, setFailed] = useState<string>();
  return src && failed !== src ? <img src={src} alt={alt} className={className} loading={loading} decoding="async" onError={() => setFailed(src)} /> : <div role="img" aria-label={alt} className={`flex flex-col items-center justify-center gap-2 bg-slate-50 text-slate-400 ${className}`}><Package className="h-8 w-8" /><span className="text-xs">{src ? "Image unavailable" : "Photo coming soon"}</span></div>;
}

export function ImageLightbox({ image, onClose }: { image: { name: string; url: string } | null; onClose: () => void }) {
  return <Dialog open={Boolean(image)} onOpenChange={(open) => !open && onClose()}><DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto rounded-2xl"><DialogHeader><DialogTitle>{image?.name}</DialogTitle><DialogDescription>View the original image for a closer look.</DialogDescription></DialogHeader>{image && <><ProductImage src={image.url} alt={image.name} loading="eager" className="max-h-[65dvh] w-full object-contain" /><a href={image.url} target="_blank" rel="noreferrer" className="text-center text-sm font-medium underline underline-offset-4">Open full-size image</a></>}</DialogContent></Dialog>;
}

export function ProductGallery({ name, ids, images }: { name: string; ids: string[]; images: Record<string, string> }) {
  const [selected, setSelected] = useState<string>();
  const [preview, setPreview] = useState(false);
  const active = selected && ids.includes(selected) ? selected : ids[0];
  const url = images[active];
  return <div><button type="button" disabled={!url} aria-label={`Enlarge ${name} photo`} onClick={() => setPreview(true)} className="relative block aspect-square w-full bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500"><ProductImage src={url} alt={name} className="h-full w-full object-contain p-4" />{url && <ZoomIn className="absolute bottom-4 right-4 h-5 w-5 text-slate-500" />}</button>{ids.length > 1 && <div aria-label={`${name} photos`} className="flex gap-2 overflow-x-auto border-t border-slate-100 p-3">{ids.map((id, index) => <button key={id} type="button" aria-label={`View ${name} photo ${index + 1}`} aria-pressed={id === active} onClick={() => setSelected(id)} className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${id === active ? "border-slate-900" : "border-transparent hover:border-slate-300"}`}><ProductImage src={images[id]} alt={`${name}, photo ${index + 1}`} className="h-full w-full object-contain" /></button>)}</div>}<ImageLightbox image={preview && url ? { name, url } : null} onClose={() => setPreview(false)} /></div>;
}
