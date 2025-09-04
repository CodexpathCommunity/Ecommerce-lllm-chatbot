import { useEffect, useState } from "react";

type Product = {
  _id: string;
  item_id: string;
  item_name: string;
  item_description: string;
  brand: string;
  manufacturer_address: {
    street: string;
    city: string;
    state: string;
    postal_code: string;
    country: string;
  };
  prices: {
    full_price: number;
    sale_price: number;
  };
  categories: string[];
  user_reviews: {
    review_date: string;
    rating: number;
    comment: string;
  }[];
  notes: string;
  embedding_text: string;
  embedding: number[];
};

type Props = {};

const ItemList = (props: Props) => {
  const [products, setProducts] = useState<Product[]>([]);

  const handleGetInventoryProducts = async () => {
    try {
      const response = await fetch("http://localhost:8000/products");
      const data = await response.json();
      console.log("Fetched products:", data);
      setProducts(data);
    } catch (error) {
      console.error("Error fetching products:", error);
    }
  };

  useEffect(() => {
    handleGetInventoryProducts();
  }, []);

  return (
    <div style={{ maxWidth: "1280px", margin: "0 auto", padding: "20px" }}>
      <h2 style={{ fontSize: "24px", marginBottom: "20px" }}>Product List</h2>
      <div
        className="product-container"
        style={{ }}
      >
        {products.map((product) => (
          <div
            key={product._id}
            style={{
              border: "1px solid #ddd",
              padding: "10px",
              width: "100%",
              borderRadius: "8px",
            }}
          >
            <h3 style={{ fontSize: "1.2rem", marginBottom: "5px" }}>
              {product.item_name}
            </h3>
            <p style={{ fontSize: "0.9rem", color: "#666" }}>
              Brand: {product.brand}
            </p>
            <p style={{ fontSize: "0.9rem", color: "#666" }}>
              {product.item_description}
            </p>
            <p style={{ fontSize: "1rem", fontWeight: "bold" }}>
              Price: ${product.prices.sale_price}
            </p>
            <p style={{ fontSize: "0.8rem", color: "#888" }}>
              Categories: {product.categories.join(", ")}
            </p>
            {product.user_reviews.length > 0 && (
              <div style={{ marginTop: "10px" }}>
                <p style={{ fontSize: "0.8rem", fontWeight: "bold" }}>
                  Latest Review:
                </p>
                <p style={{ fontSize: "0.7rem" }}>
                  Rating: {product.user_reviews[0].rating}
                </p>
                <p style={{ fontSize: "0.7rem" }}>
                  Comment: {product.user_reviews[0].comment}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ItemList;
