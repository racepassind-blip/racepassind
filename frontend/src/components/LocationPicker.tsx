import { useEffect, useRef, useState } from "react";
import { MapPin, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

interface MapsLatLng {
  lat(): number;
  lng(): number;
}

interface MapsListener {
  remove?: () => void;
}

interface MapsMap {
  setCenter(center: { lat: number; lng: number }): void;
  setZoom(zoom: number): void;
  addListener(eventName: string, handler: (event: { latLng?: MapsLatLng }) => void): MapsListener;
}

interface MapsMarker {
  setMap(map: MapsMap | null): void;
  setPosition(position: { lat: number; lng: number }): void;
  getPosition(): MapsLatLng | undefined;
  addListener(eventName: string, handler: () => void): MapsListener;
}

interface MapsApi {
  Map: new (element: HTMLElement, options: { center: { lat: number; lng: number }; zoom: number; streetViewControl: boolean; mapTypeControl: boolean; fullscreenControl: boolean }) => MapsMap;
  Marker: new (options: { map: MapsMap; position: { lat: number; lng: number }; draggable: boolean; title: string }) => MapsMarker;
}

interface GoogleMapsWindow extends Window {
  google?: { maps?: MapsApi };
}

const DEFAULT_CENTER = { lat: 20.5937, lng: 78.9629 };
let mapsLoader: Promise<MapsApi> | null = null;

function loadGoogleMaps(apiKey: string): Promise<MapsApi> {
  const googleWindow = window as GoogleMapsWindow;
  if (googleWindow.google?.maps) return Promise.resolve(googleWindow.google.maps);
  if (mapsLoader) return mapsLoader;

  mapsLoader = new Promise<MapsApi>((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>("script[data-racepass-google-maps]");
    if (existingScript) {
      existingScript.addEventListener("load", () => {
        const maps = (window as GoogleMapsWindow).google?.maps;
        if (maps) {
          resolve(maps);
        } else {
          reject(new Error("Google Maps did not load."));
        }
      }, { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Google Maps could not load.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.dataset.racepassGoogleMaps = "true";
    script.onload = () => {
      const maps = (window as GoogleMapsWindow).google?.maps;
      if (maps) {
        resolve(maps);
      } else {
        reject(new Error("Google Maps did not load."));
      }
    };
    script.onerror = () => reject(new Error("Google Maps could not load."));
    document.head.appendChild(script);
  });

  return mapsLoader;
}

interface LocationPickerProps {
  latitude: number | null;
  longitude: number | null;
  onChange: (coordinates: { latitude: number; longitude: number } | null) => void;
}

export function LocationPicker({ latitude, longitude, onChange }: LocationPickerProps) {
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapsMap | null>(null);
  const markerRef = useRef<MapsMarker | null>(null);
  const mapsRef = useRef<MapsApi | null>(null);
  const onChangeRef = useRef(onChange);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim();
  const latitudeRef = useRef(latitude);
  const longitudeRef = useRef(longitude);

  onChangeRef.current = onChange;
  latitudeRef.current = latitude;
  longitudeRef.current = longitude;

  useEffect(() => {
    if (!apiKey || !mapElementRef.current) return;
    let active = true;
    setStatus("loading");

    loadGoogleMaps(apiKey)
      .then((maps) => {
        if (!active || !mapElementRef.current) return;
        mapsRef.current = maps;
        const hasCoordinates = latitudeRef.current !== null && longitudeRef.current !== null;
        const initialCenter = hasCoordinates ? { lat: latitudeRef.current as number, lng: longitudeRef.current as number } : DEFAULT_CENTER;
        const map = new maps.Map(mapElementRef.current, {
          center: initialCenter,
          zoom: hasCoordinates ? 15 : 5,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        });
        mapRef.current = map;

        const updateMarker = (position: MapsLatLng) => {
          const next = { latitude: position.lat(), longitude: position.lng() };
          if (!markerRef.current) {
            markerRef.current = new maps.Marker({
              map,
              position: { lat: next.latitude, lng: next.longitude },
              draggable: true,
              title: "Event location",
            });
            markerRef.current.addListener("dragend", () => {
              const markerPosition = markerRef.current?.getPosition();
              if (markerPosition) updateMarker(markerPosition);
            });
          } else {
            markerRef.current.setPosition({ lat: next.latitude, lng: next.longitude });
          }
          map.setCenter({ lat: next.latitude, lng: next.longitude });
          map.setZoom(15);
          onChangeRef.current(next);
        };

        map.addListener("click", (event) => {
          if (event.latLng) updateMarker(event.latLng);
        });

        if (hasCoordinates) {
          markerRef.current = new maps.Marker({
            map,
            position: initialCenter,
            draggable: true,
            title: "Event location",
          });
          markerRef.current.addListener("dragend", () => {
            const markerPosition = markerRef.current?.getPosition();
            if (markerPosition) updateMarker(markerPosition);
          });
        }
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });

    return () => {
      active = false;
      markerRef.current?.setMap(null);
      markerRef.current = null;
      mapRef.current = null;
    };
  }, [apiKey]);

  useEffect(() => {
    if (!mapRef.current || !mapsRef.current) return;
    if (latitude === null || longitude === null) {
      markerRef.current?.setMap(null);
      markerRef.current = null;
      return;
    }
    const position = { lat: latitude, lng: longitude };
    if (!markerRef.current) {
      markerRef.current = new mapsRef.current.Marker({
        map: mapRef.current,
        position,
        draggable: true,
        title: "Event location",
      });
    } else {
      markerRef.current.setPosition(position);
    }
    mapRef.current.setCenter(position);
    mapRef.current.setZoom(15);
  }, [latitude, longitude]);

  if (!apiKey) return null;

  if (status === "error") {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-2 font-medium text-foreground"><MapPin className="h-4 w-4 text-primary" /> Google Maps is unavailable</div>
        <p className="mt-1">Check the API key, enabled Maps JavaScript API, billing, and allowed website referrers. You can still save the text location.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div ref={mapElementRef} className="h-64 w-full bg-muted" aria-label="Choose event location on map" />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm">
        <p className="text-muted-foreground">
          {status === "loading" ? "Loading Google Maps…" : latitude !== null && longitude !== null ? `Marked at ${latitude.toFixed(6)}, ${longitude.toFixed(6)}` : "Click the map or drag the marker to mark the event location."}
        </p>
        {latitude !== null && longitude !== null && <Button type="button" variant="ghost" size="sm" onClick={() => onChangeRef.current(null)}><RotateCcw className="mr-1.5 h-4 w-4" /> Clear pin</Button>}
      </div>
    </div>
  );
}
