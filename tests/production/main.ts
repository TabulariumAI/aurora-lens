import * as lens from "../../dist/index.js";
import tiff from "../fixtures/deed.tiff?url";
import png from "../fixtures/beneficiary.png?url";

Object.assign(window, { lens, fixtures: { tiff, png } });
