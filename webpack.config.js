const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = (env = {}, argv) => {
  const isDev = argv.mode === "development";
  const isMock = !!env.mock;

  /** @type {import('webpack').Configuration} */
  const config = {
    target: "web",
    entry: {
      hub: "./src/hub/hub.tsx",
    },
    output: {
      filename: "[name]/[name].js",
      path: path.resolve(__dirname, "dist"),
      clean: !isMock, // don't wipe dist when using dev server
    },
    resolve: {
      extensions: [".ts", ".tsx", ".js"],
      fallback: {
        path: false,
        os: false,
        crypto: false,
        fs: false,
      },
      // In mock mode, redirect real ADO SDK/API to local stubs
      alias: isMock
        ? {
            "azure-devops-extension-sdk": path.resolve(__dirname, "src/mocks/sdk.ts"),
            "azure-devops-extension-api/Git": path.resolve(__dirname, "node_modules/azure-devops-extension-api/Git"),
            "azure-devops-extension-api": path.resolve(__dirname, "src/mocks/api.ts"),
          }
        : {},
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: "ts-loader",
          exclude: /node_modules/,
        },
        {
          test: /\.s[ac]ss$/i,
          use: [
            "style-loader",
            "css-loader",
            { loader: "sass-loader", options: { api: "modern" } },
          ],
        },
        {
          test: /\.css$/i,
          use: ["style-loader", "css-loader"],
        },
      ],
    },
    plugins: [
      new CopyWebpackPlugin({
        patterns: [
          { from: "src/hub/hub.html", to: "hub/hub.html" },
        ],
      }),
    ],
    devtool: isDev ? "inline-source-map" : false,
    performance: { hints: false },
  };

  if (isMock) {
    config.devServer = {
      static: {
        directory: path.resolve(__dirname, "dist"),
        publicPath: "/",
      },
      port: 3000,
      open: "/hub/hub.html",
      hot: true,
      historyApiFallback: true,
    };
  }

  return config;
};
