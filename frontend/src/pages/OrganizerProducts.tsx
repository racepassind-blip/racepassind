import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ImagePlus, Package, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { OrganizerDashboardLayout } from "@/components/OrganizerDashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ProductImage, ImageLightbox } from "@/components/products/ProductMedia";
import { apiRequest, uploadFile } from "@/lib/api";

type Organization = { id: string; name: string };
type Variant = { id: string; label: string; price_paise: number; stock: number; options: Record<string, string> };
type Product = { id: string; name: string; description: string; image_ids: string[]; size_chart_image_id: string | null; customization_label: string | null; active: boolean; variants: Variant[] };
type Listing = { id: string; organization_id: string; name: string; description: string; status: string; fee_bearer: "ORGANIZER" | "PARTICIPANT"; upi_id: string; payee_name: string; catalog: { listing_type: "products"; products: Product[]; max_units_per_order: number; fulfillment: "pickup"; pickup_instructions: string }; images: Record<string, string>; has_orders: boolean };
type Order = { id: string; buyer_name: string; buyer_email: string; buyer_phone: string; status: string; payment_reference: string | null; snapshot: { total_paise: number; lines: Array<{ product_name: string; variant_label: string; quantity: number }> } };

const uid = () => crypto.randomUUID();
const blankProduct = (): Product => ({ id: uid(), name: "", description: "", image_ids: [], size_chart_image_id: null, customization_label: null, active: true, variants: [{ id: uid(), label: "Standard", price_paise: 0, stock: 1, options: {} }] });

export default function OrganizerProducts() {
  const { listingId } = useParams();
  const navigate = useNavigate();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [maxUnits, setMaxUnits] = useState(10);
  const [pickup, setPickup] = useState("");
  const [feeBearer, setFeeBearer] = useState<"ORGANIZER" | "PARTICIPANT">("ORGANIZER");
  const [upiId, setUpiId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [products, setProducts] = useState<Product[]>([blankProduct()]);
  const [images, setImages] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("draft");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [stockBaseline, setStockBaseline] = useState<Record<string, number>>({});
  const [hasOrders, setHasOrders] = useState(false);
  const [savedProductIds, setSavedProductIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState("");
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoadError("");
    const [orgs, all] = await Promise.all([apiRequest<Organization[]>("/organizer/organizations"), apiRequest<Listing[]>("/organizer/product-listings")]);
    setOrganizations(orgs); setListings(all); if (!organizationId) setOrganizationId(orgs[0]?.id ?? "");
    const item = listingId ? all.find((entry) => entry.id === listingId) : null;
    if (listingId && !item) throw new Error("Storefront not found.");
    if (item) { setStockBaseline(Object.fromEntries(item.catalog.products.flatMap((product) => product.variants.map((variant) => [variant.id, variant.stock])))); setHasOrders(item.has_orders); setSavedProductIds(item.catalog.products.map((product) => product.id)); setOrganizationId(item.organization_id); setName(item.name); setDescription(item.description); setMaxUnits(item.catalog.max_units_per_order); setPickup(item.catalog.pickup_instructions); setFeeBearer(item.fee_bearer); setUpiId(item.upi_id); setPayeeName(item.payee_name); setProducts(item.catalog.products); setImages(item.images); setStatus(item.status); setOrders(await apiRequest<Order[]>(`/organizer/product-listings/${item.id}/orders`)); }
  };
  useEffect(() => { setLoading(true); void load().catch((error) => setLoadError(error instanceof Error ? error.message : "Could not load product sales.")).finally(() => setLoading(false)); }, [listingId]);

  const updateProduct = (id: string, patch: Partial<Product>) => setProducts((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const updateVariant = (productId: string, variantId: string, patch: Partial<Variant>) => setProducts((current) => current.map((product) => product.id === productId ? { ...product, variants: product.variants.map((variant) => variant.id === variantId ? { ...variant, ...patch } : variant) } : product));
  const payload = () => ({ ...(listingId ? { stock_baseline: stockBaseline } : {}), organization_id: organizationId, name, description, fee_bearer: feeBearer, upi_id: upiId, payee_name: payeeName, catalog: { listing_type: "products", products, max_units_per_order: maxUnits, fulfillment: "pickup", pickup_instructions: pickup } });

  const save = async () => {
    setSaving(true);
    try {
      const item = await apiRequest<Listing>(listingId ? `/organizer/product-listings/${listingId}` : "/organizer/product-listings", { method: listingId ? "PUT" : "POST", body: JSON.stringify(payload()) });
      setFeedback("All changes saved.");
      toast.success(listingId ? "Product listing saved." : "Product listing created. Add images and publish when ready.");
      if (!listingId) navigate(`/organizer/products/${item.id}`); else await load();
    } catch (error) { const message = error instanceof Error ? error.message : "Could not save product listing."; setFeedback(message); toast.error(message); } finally { setSaving(false); }
  };

  const upload = async (file: File, product: Product, kind: "product" | "size") => {
    if (!listingId) { toast.error("Save the listing before uploading images."); return; }
    setUploading(true); setFeedback("Uploading image…");
    try {
      const uploaded = await uploadFile<{ id: string; url: string }>(`/organizer/product-listings/${listingId}/images?product_id=${product.id}&kind=${kind}`, file);
      setImages((current) => ({ ...current, [uploaded.id]: uploaded.url }));
      setProducts((current) => current.map((item) => item.id === product.id ? { ...item, ...(kind === "product" ? { image_ids: [...item.image_ids, uploaded.id] } : { size_chart_image_id: uploaded.id }) } : item));
      setFeedback("Image uploaded and saved. Other edits still need Save changes.");
      toast.success(kind === "size" ? "Size chart saved and ready for customers." : "Product photo saved.");
    } catch (error) { const message = error instanceof Error ? error.message : "Upload failed. Please try again."; setFeedback(message); toast.error(message); }
    finally { setUploading(false); }
  };

  const changeStatus = async (next: "published" | "closed") => {
    if (!listingId) return;
    try { await apiRequest(`/organizer/product-listings/${listingId}/status`, { method: "POST", body: JSON.stringify({ status: next }) }); setStatus(next); toast.success(next === "published" ? "Storefront published." : "Sales closed."); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update sales status."); }
  };

  const decide = async (order: Order, decision: "approve" | "reject" | "fulfilled") => { try { await apiRequest(`/organizer/product-listings/${listingId}/orders/${order.id}`, { method: "POST", body: JSON.stringify({ decision }) }); await load(); toast.success("Order updated."); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update order."); } };

  if (loading || loadError) return <OrganizerDashboardLayout><div className="p-12 text-center" role={loadError ? "alert" : "status"}>{loadError || "Loading merchandise studio…"}{loadError && <Button className="ml-4" onClick={() => { setLoading(true); void load().catch((error) => setLoadError(error.message)).finally(() => setLoading(false)); }}>Try again</Button>}</div></OrganizerDashboardLayout>;

  return <OrganizerDashboardLayout><div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
    <div className="overflow-hidden rounded-3xl bg-[#101b35] px-6 py-8 text-white shadow-xl sm:px-8"><div className="flex flex-wrap items-center justify-between gap-5"><div><p className="text-xs font-bold uppercase tracking-[0.22em] text-orange-400">Merchandise studio</p><h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{listingId ? "Shape your storefront" : "Start selling products"}</h1><p className="mt-3 max-w-xl text-sm leading-6 text-white/70">Create a polished pickup shop for race jerseys, apparel, and race-day merchandise.</p></div>{listingId && <div className="flex flex-wrap gap-2">{status !== "draft" && <Button asChild variant="secondary"><Link to={`/products/${listingId}`} target="_blank">View published store</Link></Button>}{status === "published" ? <Button variant="outline" className="border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={() => void changeStatus("closed")}>Close sales</Button> : <Button onClick={() => void changeStatus("published")}>Publish store</Button>}</div>}</div><div className="mt-7 grid max-w-2xl gap-3 text-sm sm:grid-cols-3"><div className="rounded-2xl bg-white/10 p-3"><p className="font-bold">1</p><p className="mt-1 text-white/60">Add products</p></div><div className="rounded-2xl bg-white/10 p-3"><p className="font-bold">2</p><p className="mt-1 text-white/60">Set stock & pricing</p></div><div className="rounded-2xl bg-white/10 p-3"><p className="font-bold">3</p><p className="mt-1 text-white/60">Publish & collect</p></div></div></div>
    {!listingId && listings.length > 0 && <Card className="overflow-hidden rounded-3xl"><CardHeader><CardTitle>Your storefronts</CardTitle><CardDescription>Jump back into a shop to update stock or review orders.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">{listings.map((item) => <Link className="group rounded-2xl border p-4 transition hover:-translate-y-0.5 hover:border-orange-300 hover:shadow-md" key={item.id} to={`/organizer/products/${item.id}`}><div className="flex items-center justify-between"><span className="font-bold group-hover:text-orange-600">{item.name}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs capitalize text-muted-foreground">{item.status}</span></div></Link>)}</CardContent></Card>}
    {hasOrders && <p className="rounded-xl bg-amber-50 p-4 text-sm">You can update names, photos, size charts and inventory. Existing orders keep their original details. Products and sizes cannot be removed once orders exist; set stock to 0 to stop sales.</p>}
    <fieldset disabled={uploading || saving} className="min-w-0 space-y-6 disabled:opacity-70">
    <Card className="rounded-3xl border-slate-200 shadow-sm"><CardHeader><CardTitle>Store details</CardTitle><CardDescription>Give participants the information they need to buy with confidence.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div><Label>Organization</Label><Select value={organizationId} onValueChange={setOrganizationId} disabled={Boolean(listingId)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{organizations.map((org) => <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Storefront name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Official race merchandise" /></div><div className="sm:col-span-2"><Label>Short description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What can participants shop here?" /></div><div><Label>Maximum units per transaction</Label><Input type="number" min={1} max={100} value={maxUnits} onChange={(e) => setMaxUnits(Number(e.target.value))} /><p className="mt-1 text-xs text-muted-foreground">Applies across the whole cart.</p></div><div><Label>Pickup instructions</Label><Input value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder="Collect at the venue from 8 AM" /></div><div><Label>UPI ID</Label><Input value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="name@bank" /></div><div><Label>Payee name</Label><Input value={payeeName} onChange={(e) => setPayeeName(e.target.value)} /></div><div><Label>SportPass fee</Label><Select value={feeBearer} onValueChange={(value) => setFeeBearer(value as typeof feeBearer)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ORGANIZER">Organizer pays</SelectItem><SelectItem value="PARTICIPANT">Buyer pays</SelectItem></SelectContent></Select></div></CardContent></Card>
    {products.map((product, productIndex) => <Card key={product.id} className="overflow-hidden rounded-3xl border-slate-200 shadow-sm"><CardHeader className="bg-slate-50/70"><div className="flex justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">Product {productIndex + 1}</p><CardTitle className="mt-1">{product.name || "New race merchandise"}</CardTitle><CardDescription>Add a strong image and clear options so participants can choose quickly.</CardDescription></div>{products.length > 1 && <Button aria-label={`Remove product ${productIndex + 1}`} disabled={hasOrders} size="icon" variant="ghost" onClick={() => setProducts((items) => items.filter((item) => item.id !== product.id))}><Trash2 className="h-4 w-4" /></Button>}</div></CardHeader><CardContent className="space-y-5 p-6"><div className="grid gap-4 sm:grid-cols-2"><div><Label>Product name</Label><Input value={product.name} onChange={(e) => updateProduct(product.id, { name: e.target.value })} placeholder="Race jersey" /></div><div><Label>Customization label (optional)</Label><Input value={product.customization_label ?? ""} onChange={(e) => updateProduct(product.id, { customization_label: e.target.value || null })} placeholder="Printed name" /></div><div className="sm:col-span-2"><Label>Description</Label><Textarea value={product.description} onChange={(e) => updateProduct(product.id, { description: e.target.value })} placeholder="Describe what the buyer receives." /></div></div>{(!listingId || !savedProductIds.includes(product.id)) && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Save this product to enable photo and size-chart uploads.</p>}{listingId && savedProductIds.includes(product.id) && <div className="grid gap-3 sm:grid-cols-2"><label className="cursor-pointer rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm transition hover:border-orange-400 hover:bg-orange-50/50"><ImagePlus className="mb-2 h-5 w-5 text-orange-600" /><span className="font-bold">Product image</span><p className="mt-1 text-xs text-muted-foreground">Up to 8 photos. The first photo is the cover; every photo appears in the customer gallery.</p><Input className="mt-3 bg-white" disabled={uploading || saving} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void upload(file, product, "product"); }} /></label><label className="cursor-pointer rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm transition hover:border-orange-400 hover:bg-orange-50/50"><ImagePlus className="mb-2 h-5 w-5 text-orange-600" /><span className="font-bold">Size chart</span><p className="mt-1 text-xs text-muted-foreground">Upload the actual measurements chart. Customers open it beside the size selector. Uploads are saved immediately.</p><Input className="mt-3 bg-white" disabled={uploading || saving} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void upload(file, product, "size"); }} /></label></div>}
          <div className="grid gap-6 sm:grid-cols-2"><div><p className="mb-3 text-sm font-medium">Customer gallery · {product.image_ids.length}/8 photos</p><div className="flex flex-wrap gap-3">{product.image_ids.map((id, index) => <div key={id} className="w-24"><button type="button" aria-label={`Preview ${product.name} photo ${index + 1}`} className="h-24 w-24 overflow-hidden rounded-xl border" onClick={() => setPreview({ name: product.name || "Product photo", url: images[id] })}><ProductImage src={images[id]} alt={`Photo ${index + 1}`} className="h-full w-full object-contain" /></button><p className="mt-1 text-xs text-slate-500">{index === 0 ? "Cover photo" : `Photo ${index + 1}`}</p><button type="button" className="mt-1 text-xs underline" onClick={() => updateProduct(product.id, { image_ids: product.image_ids.filter((imageId) => imageId !== id) })}>Remove</button></div>)}</div></div><div><p className="mb-3 text-sm font-medium">Size chart · customer preview</p>{product.size_chart_image_id ? <><button type="button" className="h-40 w-full overflow-hidden rounded-xl border bg-white p-2" onClick={() => setPreview({ name: `${product.name} — Size chart`, url: images[product.size_chart_image_id!] })}><ProductImage src={images[product.size_chart_image_id]} alt={`${product.name} size chart`} className="h-full w-full object-contain" /></button><button type="button" className="mt-2 text-xs underline" onClick={() => updateProduct(product.id, { size_chart_image_id: null })}>Remove size chart</button></> : <p className="rounded-xl border border-dashed p-6 text-sm text-slate-400">No size chart uploaded yet.</p>}</div></div>
          <div><h3 className="font-semibold">Sizes, pricing & stock</h3><p className="mt-1 text-sm text-slate-500">Use labels such as S, M, L or “M / Navy”. Stock is the quantity available to sell. Your adjustment is applied to live inventory, preserving orders placed while you edit. Set stock to 0 to disable an option.</p></div><div className="space-y-3">{product.variants.map((variant) => <div key={variant.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-4"><div><Label>Option / size</Label><Input className="mt-1.5 bg-white" value={variant.label} onChange={(e) => updateVariant(product.id, variant.id, { label: e.target.value })} /></div><div><Label>Price (₹)</Label><Input className="mt-1.5 bg-white" type="number" min={0} step="0.01" value={variant.price_paise / 100} onChange={(e) => updateVariant(product.id, variant.id, { price_paise: Math.round(Number(e.target.value) * 100) })} /></div><div><Label>Available stock</Label><Input className="mt-1.5 bg-white" type="number" min={0} value={variant.stock} onChange={(e) => updateVariant(product.id, variant.id, { stock: Number(e.target.value) })} /></div><div className="flex items-end"><Button variant="ghost" disabled={hasOrders || product.variants.length === 1} onClick={() => updateProduct(product.id, { variants: product.variants.filter((item) => item.id !== variant.id) })}>Remove</Button></div></div>)}</div><Button variant="outline" className="rounded-xl" onClick={() => updateProduct(product.id, { variants: [...product.variants, { id: uid(), label: "", price_paise: 0, stock: 1, options: {} }] })}><Plus className="mr-2 h-4 w-4" />Add option</Button></CardContent></Card>)}
    </fieldset>
    <p role="status" className="text-sm text-slate-600">{feedback}</p>
    <div className="sticky bottom-0 z-10 flex flex-wrap justify-between gap-3 rounded-xl border bg-white/95 p-4 shadow-sm"><Button disabled={saving || uploading} variant="outline" onClick={() => setProducts((items) => [...items, blankProduct()])}><Package className="mr-2 h-4 w-4" />Add product</Button><Button disabled={saving || uploading} onClick={() => void save()}>{saving ? "Saving…" : listingId ? "Save changes" : "Create storefront"}</Button></div>
    {listingId && <Card><CardHeader><CardTitle>Orders</CardTitle><CardDescription>Approve submitted UPI references, reject them to return stock, then mark pickup complete.</CardDescription></CardHeader><CardContent className="space-y-3">{orders.length === 0 ? <p className="text-sm text-muted-foreground">No orders yet.</p> : orders.map((order) => <div key={order.id} className="flex flex-col gap-3 rounded-xl border p-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="font-semibold">{order.buyer_name} · ₹{(order.snapshot.total_paise / 100).toFixed(2)}</p><p className="text-xs text-muted-foreground">{order.snapshot.lines.map((line) => `${line.product_name} ${line.variant_label} × ${line.quantity}`).join(", ")} · {order.status.replace(/_/g, " ")}{order.payment_reference ? ` · Ref ${order.payment_reference}` : ""}</p></div><div className="flex gap-2">{order.status === "under_review" && <><Button size="sm" variant="outline" onClick={() => void decide(order, "reject")}>Reject</Button><Button size="sm" onClick={() => void decide(order, "approve")}>Approve</Button></>}{order.status === "confirmed" && <Button size="sm" onClick={() => void decide(order, "fulfilled")}>Mark collected</Button>}</div></div>)}</CardContent></Card>}
    <ImageLightbox image={preview} onClose={() => setPreview(null)} />
  </div></OrganizerDashboardLayout>;
}
