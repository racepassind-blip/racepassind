import heroCycling from "@/assets/event-cycling.jpg";
import heroTriathlon from "@/assets/event-triathlon.jpg";
import heroTrail from "@/assets/event-trail.jpg";
import heroMarathon from "@/assets/hero-marathon.jpg";

export interface TicketTier {
  id: string;
  name: string;
  price: number;
  description: string;
  available: number;
}

export interface SportEvent {
  id: string;
  title: string;
  date: string;
  location: string;
  category: string;
  image: string;
  description: string;
  distance: string;
  participants: number;
  maxParticipants: number;
  organizer: string;
  rules: string[];
  tiers: TicketTier[];
}

export const mockEvents: SportEvent[] = [
  {
    id: "1",
    title: "Alpine Gran Fondo",
    date: "2026-06-15",
    location: "Innsbruck, Austria",
    category: "cycling",
    image: heroCycling,
    description: "Conquer the Austrian Alps in this epic gran fondo featuring 4 legendary mountain passes. A true test of endurance through stunning Alpine scenery with aid stations every 30km. The route takes you through picturesque valleys, over dramatic switchbacks, and past crystal-clear mountain lakes. Whether you're a seasoned climber or looking for your first mountain challenge, this event offers an unforgettable experience in one of Europe's most breathtaking cycling destinations.",
    distance: "160 km",
    participants: 1842,
    maxParticipants: 3000,
    organizer: "Alpine Sports GmbH",
    rules: [
      "All participants must wear an approved cycling helmet at all times during the event.",
      "Drafting behind motor vehicles is strictly prohibited and will result in disqualification.",
      "Each rider must carry a mobile phone for emergency contact purposes.",
      "Cutting the course or taking shortcuts will result in immediate disqualification.",
      "Participants must pass through all checkpoints within the designated cut-off times.",
      "No external support vehicles are allowed on the course except at designated feed zones.",
    ],
    tiers: [
      { id: "t1a", name: "Early Bird", price: 65, description: "Race entry, timing chip, finisher medal — limited availability", available: 80 },
      { id: "t1b", name: "Regular", price: 85, description: "Race entry, timing chip, finisher medal", available: 420 },
      { id: "t1c", name: "Late Entry", price: 110, description: "Race entry, timing chip, finisher medal — last chance", available: 200 },
      { id: "t1d", name: "VIP", price: 250, description: "Premium start, jersey, nutrition pack, dinner, massage, photo package", available: 40 },
    ],
  },
  {
    id: "2",
    title: "City Marathon Series",
    date: "2026-09-21",
    location: "Barcelona, Spain",
    category: "marathon",
    image: heroMarathon,
    description: "Run through the heart of Barcelona past iconic landmarks including La Sagrada Familia and Park Güell. Flat, fast course perfect for personal bests. Experience the vibrant energy of the city as thousands of spectators line the streets to cheer you on. With world-class aid stations, professional pacing groups, and a stunning oceanfront finish line, this is the marathon experience of a lifetime.",
    distance: "42.2 km",
    participants: 8500,
    maxParticipants: 15000,
    organizer: "Barcelona Running Club",
    rules: [
      "Participants must be at least 18 years old on race day.",
      "Bib numbers must be clearly visible on the front of your torso at all times.",
      "The use of any wheeled devices (roller skates, bicycles, etc.) is prohibited.",
      "Headphones are permitted but must allow you to hear race marshal instructions.",
      "Cut-off time is 6 hours from the start of the race.",
    ],
    tiers: [
      { id: "t2a", name: "Early Bird", price: 45, description: "Race entry, bib, timing, finisher medal — early pricing", available: 150 },
      { id: "t2b", name: "Regular", price: 60, description: "Race entry, bib, timing, finisher medal", available: 3200 },
      { id: "t2c", name: "Late Entry", price: 80, description: "Race entry, bib, timing, finisher medal — late registration", available: 800 },
      { id: "t2d", name: "VIP", price: 150, description: "Runner + t-shirt, nutrition, pace group, VIP lounge access", available: 200 },
    ],
  },
  {
    id: "3",
    title: "Ironshore Triathlon",
    date: "2026-07-10",
    location: "Nice, France",
    category: "triathlon",
    image: heroTriathlon,
    description: "Swim in the Mediterranean, cycle the Côte d'Azur coastline, and run along the Promenade des Anglais in this Olympic-distance triathlon. A truly spectacular multi-sport event set against the stunning French Riviera backdrop. With crystal-clear waters, smooth coastal roads, and a flat run course, this is the perfect event for both first-timers and seasoned triathletes.",
    distance: "51.5 km total",
    participants: 1200,
    maxParticipants: 2000,
    organizer: "Côte d'Azur Tri Club",
    rules: [
      "Wetsuits are mandatory if water temperature is below 16°C.",
      "All bicycles must pass a safety inspection before the race.",
      "Transition area rules must be followed — no blocking other athletes' spaces.",
      "Helmets must be fastened before removing your bike from the rack.",
      "No outside assistance is allowed during any segment of the race.",
    ],
    tiers: [
      { id: "t3a", name: "Early Bird", price: 90, description: "Solo entry, all transitions, finisher pack — early pricing", available: 60 },
      { id: "t3b", name: "Regular", price: 120, description: "Solo entry, all transitions, finisher pack", available: 350 },
      { id: "t3c", name: "Late Entry", price: 155, description: "Solo entry, all transitions, finisher pack — late registration", available: 150 },
      { id: "t3d", name: "VIP", price: 280, description: "Priority start, premium gear bag, post-race banquet, massage", available: 50 },
    ],
  },
  {
    id: "4",
    title: "Autumn Trail Ultra",
    date: "2026-10-04",
    location: "Black Forest, Germany",
    category: "trail",
    image: heroTrail,
    description: "An ultra-trail adventure through ancient forests and mountain ridges. Choose between 50K and 80K routes with technical terrain and breathtaking views. Navigate through misty valleys, dense woodland, and exposed ridgelines as autumn colors paint the landscape. This challenging event rewards every participant with an unforgettable journey through one of Germany's most iconic natural landscapes.",
    distance: "50 / 80 km",
    participants: 620,
    maxParticipants: 1000,
    organizer: "Black Forest Trail Runners e.V.",
    rules: [
      "Mandatory safety gear must be carried at all times (headlamp, whistle, space blanket, first aid kit).",
      "Trekking poles are permitted on all sections of the course.",
      "Participants must check in at each aid station — skipping an aid station results in disqualification.",
      "Littering on the course will result in a time penalty or disqualification.",
      "The race director reserves the right to modify the course due to weather conditions.",
      "Drop bags are only available for the 80K distance at designated stations.",
    ],
    tiers: [
      { id: "t4a", name: "Early Bird", price: 55, description: "50K or 80K entry, aid stations, medal — early pricing", available: 40 },
      { id: "t4b", name: "Regular", price: 75, description: "50K or 80K entry, aid stations, medal", available: 200 },
      { id: "t4c", name: "Late Entry", price: 95, description: "50K or 80K entry, aid stations, medal — late registration", available: 100 },
      { id: "t4d", name: "VIP", price: 180, description: "Priority start, drop bag service, post-race dinner, finisher jacket", available: 30 },
    ],
  },
];
