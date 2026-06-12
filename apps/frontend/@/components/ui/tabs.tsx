"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-oklch(0.553 0.013 58.071) group-data-[orientation=horizontal]/tabs:h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none dark:text-oklch(0.709 0.01 56.259)",
  {
    variants: {
      variant: {
        default: "bg-oklch(0.97 0.001 106.424) dark:bg-oklch(0.268 0.007 34.298)",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-oklch(0.923 0.003 48.717) border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-oklch(0.147 0.004 49.25)/60 transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-oklch(0.147 0.004 49.25) focus-visible:border-oklch(0.709 0.01 56.259) focus-visible:ring-[3px] focus-visible:ring-oklch(0.709 0.01 56.259)/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 group-data-[variant=default]/tabs-list:data-[state=active]:shadow-sm group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none dark:text-oklch(0.553 0.013 58.071) dark:hover:text-oklch(0.147 0.004 49.25) [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 dark:border-oklch(1 0 0 / 10%) dark:text-oklch(0.985 0.001 106.423)/60 dark:hover:text-oklch(0.985 0.001 106.423) dark:focus-visible:border-oklch(0.553 0.013 58.071) dark:focus-visible:ring-oklch(0.553 0.013 58.071)/50 dark:dark:text-oklch(0.709 0.01 56.259) dark:dark:hover:text-oklch(0.985 0.001 106.423)",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent",
        "data-[state=active]:bg-oklch(1 0 0) data-[state=active]:text-oklch(0.147 0.004 49.25) dark:data-[state=active]:border-oklch(0.923 0.003 48.717) dark:data-[state=active]:bg-oklch(0.923 0.003 48.717)/30 dark:data-[state=active]:text-oklch(0.147 0.004 49.25) dark:data-[state=active]:bg-oklch(0.147 0.004 49.25) dark:data-[state=active]:text-oklch(0.985 0.001 106.423) dark:dark:data-[state=active]:border-oklch(1 0 0 / 15%) dark:dark:data-[state=active]:bg-oklch(1 0 0 / 15%)/30 dark:dark:data-[state=active]:text-oklch(0.985 0.001 106.423)",
        "after:absolute after:bg-oklch(0.147 0.004 49.25) after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100 dark:after:bg-oklch(0.985 0.001 106.423)",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
