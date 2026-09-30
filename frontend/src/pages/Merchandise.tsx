import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Package } from "lucide-react";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api";

type Store = { id: string; name: string; description: string; organizer?: { name?: string }; catalog: { products: Array<{ active?: boolean; variants: Array<{ stock: number }> }> } };

export default function Merchandise() {
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => { void apiRequest<Store[]>("/products").then(setStores).catch(() => setError(true)).finally(() => setLoading(false)); }, []);
  return <Layout><main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14"><div className="max-w-3xl"><p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">SportPass stores</p><h1 className="mt-2 text-4xl font-black tracking-tight sm:text-5xl">Race merchandise</h1><p className="mt-3 text-lg text-muted-foreground">Shop official jerseys, apparel, and race-day essentials from SportPass organizers.</p></div>{loading ? <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-52 animate-pulse rounded-2xl bg-muted" />)}</div> : error ? <div role="alert" className="mt-8 rounded-xl border border-dashed p-10 text-center"><p className="font-semibold">Merchandise stores could not be loaded.</p><Button className="mt-4" variant="outline" onClick={() => window.location.reload()}>Try again</Button></div> : stores.length === 0 ? <div className="mt-8 rounded-xl border border-dashed p-12 text-center"><Package className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-3 font-semibold">No merchandise stores are live yet.</p><p className="mt-1 text-sm text-muted-foreground">Check back soon for official race merchandise.</p></div> : <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{stores.map((store) => { const products = store.catalog.products.filter((product) => product.active !== false); const units = products.reduce((total, product) => total + product.variants.reduce((sum, variant) => sum + variant.stock, 0), 0); return <article key={store.id} className="flex flex-col rounded-2xl border bg-card p-6 shadow-sm"><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Official store</p><h2 className="mt-2 text-xl font-bold">{store.name}</h2><p className="mt-1 text-sm text-muted-foreground">{store.organizer?.name || "SportPass organizer"}</p>{store.description && <p className="mt-4 line-clamp-3 text-sm leading-6 text-muted-foreground">{store.description}</p>}<div className="mt-auto flex items-center justify-between gap-3 pt-6 text-xs text-muted-foreground"><span>{products.length} {products.length === 1 ? "product" : "products"} · {units} available</span><Button asChild size="sm"><Link to={`/products/${store.id}`}>View store</Link></Button></div></article>; })}</div>}</main></Layout>;
}
