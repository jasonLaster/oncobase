import landing from "./landing.css?inline";
import publicHeader from "./public-header.css?inline";
import features from "./features.css?inline";
import oncobaseHome from "./oncobase-home.css?inline";
import compare from "./compare.css?inline";
import { adoptStyles } from "../lazy-styles";

// The marketing pages and their shared header use each other's classes
// (lp-*, ft-*, cp-*), so they adopt one sheet in the old merged order.
adoptStyles("marketing", [landing, publicHeader, features, oncobaseHome, compare].join("\n"));
