import "./style.css";

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { BufferGeometryUtils } from "three/examples/jsm/utils/BufferGeometryUtils";
import gsap from "gsap";
function main() {
  const canvas = document.getElementById("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas });
  let tl = gsap.timeline({ paused: true });
  const fov = 60;
  const aspect = 2; // the canvas default
  const near = 0.1;
  const far = 10;
  const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.z = 2.5;

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 1.2;
  controls.maxDistance = 4;
  controls.update();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("black");

  {
    const loader = new THREE.TextureLoader();
    const texture = loader.load("./resources/world.jpg", render);
    const geometry = new THREE.SphereBufferGeometry(1, 64, 32);
    const material = new THREE.MeshBasicMaterial({ map: texture });
    scene.add(new THREE.Mesh(geometry, material));
  }

  async function loadFile(url) {
    const req = await fetch(url);
    return req.text();
  }

  function parseData(text) {
    const data = [];
    const settings = { data };
    let max;
    let min;
    // split into lines
    text.split("\n").forEach((line) => {
      // split the line by whitespace
      const parts = line.trim().split(/\s+/);
      if (parts.length === 2) {
        // only 2 parts, must be a key/value pair
        settings[parts[0]] = parseFloat(parts[1]);
      } else if (parts.length > 2) {
        // more than 2 parts, must be data
        const values = parts.map((v) => {
          const value = parseFloat(v);
          if (value === settings.NODATA_value) {
            return undefined;
          }
          max = Math.max(max === undefined ? value : max, value);
          min = Math.min(min === undefined ? value : min, value);
          return value;
        });
        data.push(values);
      }
    });
    return Object.assign(settings, { min, max });
  }

  function dataMissingInAnySet(fileInfos, latNdx, lonNdx) {
    for (const fileInfo of fileInfos) {
      if (fileInfo.file.data[latNdx][lonNdx] === undefined) {
        return true;
      }
    }
    return false;
  }

  function makeBoxes(file, hueRange, fileInfos) {
    const { min, max, data } = file;
    const range = max - min;

    // these helpers will make it easy to position the boxes
    // We can rotate the lon helper on its Y axis to the longitude
    const lonHelper = new THREE.Object3D();
    scene.add(lonHelper);
    // We rotate the latHelper on its X axis to the latitude
    const latHelper = new THREE.Object3D();
    lonHelper.add(latHelper);
    // The position helper moves the object to the edge of the sphere
    const positionHelper = new THREE.Object3D();
    positionHelper.position.z = 1;
    latHelper.add(positionHelper);
    // Used to move the center of the cube so it scales from the position Z axis
    const originHelper = new THREE.Object3D();
    originHelper.position.z = 0.5;
    positionHelper.add(originHelper);

    const color = new THREE.Color();

    const lonFudge = Math.PI * 0.5;
    const latFudge = Math.PI * -0.135;
    const geometries = [];
    data.forEach((row, latNdx) => {
      row.forEach((value, lonNdx) => {
        if (dataMissingInAnySet(fileInfos, latNdx, lonNdx)) {
          return;
        }
        const amount = (value - min) / range;

        const boxWidth = 1;
        const boxHeight = 1;
        const boxDepth = 1;
        const geometry = new THREE.BoxBufferGeometry(
          boxWidth,
          boxHeight,
          boxDepth
        );

        // adjust the helpers to point to the latitude and longitude
        lonHelper.rotation.y =
          THREE.MathUtils.degToRad(lonNdx + file.xllcorner) + lonFudge;
        latHelper.rotation.x =
          THREE.MathUtils.degToRad(latNdx + file.yllcorner) + latFudge;

        // use the world matrix of the origin helper to
        // position this geometry
        positionHelper.scale.set(
          0.005,
          0.005,
          THREE.MathUtils.lerp(0.01, 0.5, amount)
        );
        originHelper.updateWorldMatrix(true, false);
        geometry.applyMatrix4(originHelper.matrixWorld);

        // compute a color
        const hue = THREE.MathUtils.lerp(...hueRange, amount);
        const saturation = 1;
        const lightness = THREE.MathUtils.lerp(0.4, 1.0, amount);
        color.setHSL(hue, saturation, lightness);
        // get the colors as an array of values from 0 to 255
        const rgb = color.toArray().map((v) => v * 255);

        // make an array to store colors for each vertex
        const numVerts = geometry.getAttribute("position").count;
        const itemSize = 3; // r, g, b
        const colors = new Uint8Array(itemSize * numVerts);

        // copy the color into the colors array for each vertex
        colors.forEach((v, ndx) => {
          colors[ndx] = rgb[ndx % 3];
        });

        const normalized = true;
        const colorAttrib = new THREE.BufferAttribute(
          colors,
          itemSize,
          normalized
        );
        geometry.setAttribute("color", colorAttrib);

        geometries.push(geometry);
      });
    });

    return BufferGeometryUtils.mergeBufferGeometries(geometries, false);
  }

  async function loadData(info) {
    const text = await loadFile(info.url);
    info.file = parseData(text);
  }

  async function loadAll() {
    const fileInfos = [
      {
        name: "men",
        hueRange: [0.7, 0.3],
        url: "./data/male.asc",
      },
      {
        name: "women",
        hueRange: [0.9, 1.1],
        url: "./data/female.asc",
      },
    ];

    await Promise.all(fileInfos.map(loadData));

    function mapValues(data, fn) {
      return data.map((row, rowNdx) => {
        return row.map((value, colNdx) => {
          return fn(value, rowNdx, colNdx);
        });
      });
    }

    function makeDiffFile(baseFile, otherFile, compareFn) {
      let min;
      let max;
      const baseData = baseFile.data;
      const otherData = otherFile.data;
      const data = mapValues(baseData, (base, rowNdx, colNdx) => {
        const other = otherData[rowNdx][colNdx];
        if (base === undefined || other === undefined) {
          return undefined;
        }
        const value = compareFn(base, other);
        min = Math.min(min === undefined ? value : min, value);
        max = Math.max(max === undefined ? value : max, value);
        return value;
      });
      // make a copy of baseFile and replace min, max, and data
      // with the new data
      return Object.assign({}, baseFile, {
        min,
        max,
        data,
      });
    }

    // generate a new set of data
    {
      const menInfo = fileInfos[0];
      const womenInfo = fileInfos[1];
      const menFile = menInfo.file;
      const womenFile = womenInfo.file;

      function amountGreaterThan(a, b) {
        return Math.max(a - b, 0);
      }
      fileInfos.push({
        name: ">50%men",
        hueRange: [0.6, 1.1],
        file: makeDiffFile(menFile, womenFile, (men, women) => {
          return amountGreaterThan(men, women);
        }),
      });
      fileInfos.push({
        name: ">50% women",
        hueRange: [0.0, 0.4],
        file: makeDiffFile(womenFile, menFile, (women, men) => {
          return amountGreaterThan(women, men);
        }),
      });
    }

    // make geometry for each data set
    const geometries = fileInfos.map((info) => {
      return makeBoxes(info.file, info.hueRange, fileInfos);
    });

    // use the first geometry as the base
    // and add all the geometries as morphtargets
    const baseGeometry = geometries[0];
    baseGeometry.morphAttributes.position = geometries.map((geometry, ndx) => {
      const attribute = geometry.getAttribute("position");
      const name = `${ndx}target`;
      attribute.name = name;
      return attribute;
    });

    const colorAttributes = geometries.map((geometry, ndx) => {
      const attribute = geometry.getAttribute("color");
      const name = `morphColor${ndx}`;
      attribute.name = `color${ndx}`; // just for debugging
      return { name, attribute };
    });

    const material = new THREE.MeshBasicMaterial({
      vertexColors: THREE.VertexColors,
      morphTargets: true,
    });

    const vertexShaderReplacements = [
      {
        from: "#include <morphtarget_pars_vertex>",
        to: `
            uniform float morphTargetInfluences[8];
          `,
      },
      {
        from: "#include <morphnormal_vertex>",
        to: `
          `,
      },
      {
        from: "#include <morphtarget_vertex>",
        to: `
            transformed += (morphTarget0 - position) * morphTargetInfluences[0];
            transformed += (morphTarget1 - position) * morphTargetInfluences[1];
            transformed += (morphTarget2 - position) * morphTargetInfluences[2];
            transformed += (morphTarget3 - position) * morphTargetInfluences[3];
          `,
      },
      {
        from: "#include <color_pars_vertex>",
        to: `
            varying vec3 vColor;
            attribute vec3 morphColor0;
            attribute vec3 morphColor1;
            attribute vec3 morphColor2;
            attribute vec3 morphColor3;
          `,
      },
      {
        from: "#include <color_vertex>",
        to: `
            vColor.xyz = morphColor0 * morphTargetInfluences[0] +
                         morphColor1 * morphTargetInfluences[1] +
                         morphColor2 * morphTargetInfluences[2] +
                         morphColor3 * morphTargetInfluences[3];
          `,
      },
    ];

    material.onBeforeCompile = (shader) => {
      vertexShaderReplacements.forEach((rep) => {
        shader.vertexShader = shader.vertexShader.replace(rep.from, rep.to);
      });
    };

    const mesh = new THREE.Mesh(baseGeometry, material);
    scene.add(mesh);

    mesh.onBeforeRender = (renderer, scene, camera, geometry) => {
      for (const { name } of colorAttributes) {
        geometry.deleteAttribute(name);
      }

      for (let i = 0; i < colorAttributes.length; ++i) {
        const attrib = geometry.getAttribute(`morphTarget${i}`);
        if (!attrib) {
          break;
        }

        const ndx = parseInt(attrib.name);
        const name = `morphColor${i}`;
        geometry.setAttribute(name, colorAttributes[ndx].attribute);
      }
    };

    // show the selected data, hide the rest
    function showFileInfo(fileInfos, fileInfo) {
      fileInfos.forEach((info) => {
        const visible = fileInfo === info;
        info.elem.className = visible ? "selected" : "";
        const targets = [];
        fileInfos.forEach((info, i) => {
          targets[i] = info === fileInfo ? 1 : 0;
        });

        tl.to(mesh.morphTargetInfluences, 0.1, targets);
        tl.play();
      });
      requestRenderIfNotRequested();
    }

    const uiElem = document.querySelector("ul");
    fileInfos.forEach((info) => {
      const div = document.createElement("li");
      info.elem = div;
      div.textContent = info.name;
      uiElem.appendChild(div);
      function show() {
        showFileInfo(fileInfos, info);
      }
      div.addEventListener("click", show);
      div.addEventListener("touchstart", show);
    });
    // show the first set of data
    showFileInfo(fileInfos, fileInfos[0]);
  }

  loadAll();

  function resizeRendererToDisplaySize(renderer) {
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
      renderer.setSize(width, height, false);
    }
    return needResize;
  }

  let renderRequested = false;

  function render() {
    renderRequested = undefined;

    if (resizeRendererToDisplaySize(renderer)) {
      const canvas = renderer.domElement;
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
    }

    if (tl.isActive()) {
      requestRenderIfNotRequested();
    }

    controls.update();
    renderer.render(scene, camera);
  }
  render();

  function requestRenderIfNotRequested() {
    if (!renderRequested) {
      renderRequested = true;
      requestAnimationFrame(render);
    }
  }

  controls.addEventListener("change", requestRenderIfNotRequested);
  window.addEventListener("resize", requestRenderIfNotRequested);
}

main();
