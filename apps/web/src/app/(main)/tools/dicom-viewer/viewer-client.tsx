"use client";

import { DicomViewerClient as SharedDicomViewerClient } from "@oncobase/diagnostics/dicom";
import { setResizableSidebarWidth } from "@/components/resizable-sidebar-store";
import type { ComponentProps } from "react";

export function DicomViewerClient(
  props: Omit<ComponentProps<typeof SharedDicomViewerClient>, "setSidebarWidth">,
) {
  return <SharedDicomViewerClient {...props} setSidebarWidth={setResizableSidebarWidth} />;
}
