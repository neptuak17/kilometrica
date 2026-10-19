/**
 * Kilometrica's UI kit (D53): shadcn/ui components on React Aria, with the owner's shadcn/create preset, and
 * Kilometrica's own pieces built from them. Styles come from `@dpg/ui/theme.css` (Tailwind v4); the built
 * `dist/styles.css` is the compiled form synced to Claude Design.
 */

// shadcn/ui components (the preset's look)
export * from "./components/ui/alert"
export * from "./components/ui/badge"
export * from "./components/ui/button"
export * from "./components/ui/card"
export * from "./components/ui/checkbox"
export * from "./components/ui/dialog"
export * from "./components/ui/input"
export * from "./components/ui/input-group"
export * from "./components/ui/label"
export * from "./components/ui/popover"
export * from "./components/ui/select"
export * from "./components/ui/separator"
export * from "./components/ui/switch"
export * from "./components/ui/table"
export * from "./components/ui/tabs"
export * from "./components/ui/textarea"
export * from "./components/ui/toggle"
export * from "./components/ui/toggle-group"
export * from "./components/ui/tooltip"

// Kilometrica's own pieces
export * from "./components/km/change-bar"
export * from "./components/km/day-row"
export * from "./components/km/effort-chart"
export * from "./components/km/elevation-profile"
export * from "./components/km/stretch-card"

// A labelled text field wraps Label + Input; React Aria's TextField provides the wiring.
export { TextField } from "react-aria-components"
export { cn } from "./lib/utils"

// Icons as one set (Icons.Bed, Icons.TriangleAlert…), for apps and designs built with the kit.
export * as Icons from "./icons"
