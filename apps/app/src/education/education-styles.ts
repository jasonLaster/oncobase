import css from "@oncobase/education/styles.css?inline";
import uiCss from "./education-ui.css?inline";
import { adoptStyles } from "../lazy-styles";

adoptStyles("education", `${css}\n${uiCss}`);
