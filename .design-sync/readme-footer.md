## Theme and React

- Colour values live in `tokens.json`; `tokens.css` declares light on `:root` and `[data-theme="light"]`, dark on `[data-theme="dark"]`. For dark mode set `data-theme="dark"` on `<html>`: the colours switch, and `components/bundle.css` applies the components' dark styles under `data-theme="dark"` as well as under the `dark` class.
- React {{reactVersion}}, with ReactDOM, is one file: `components/lib/react.js`. Load it before `components/bundle.js`; `components/lib/react-dom.js` is an empty stub beside it.
