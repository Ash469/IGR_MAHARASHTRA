import React, { useState, useEffect } from 'react';
import './App.css';
import axios from 'axios';

function App() {
  const [formData, setFormData] = useState({
    year: "2025",
    district: "",
    taluka: "",
    village: "",
    propertyNo: "",
    captcha: "" // Add captcha field
  });

  const [loading, setLoading] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [years, setYears] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [talukas, setTalukas] = useState([]);
  const [villages, setVillages] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [captchaRequired, setCaptchaRequired] = useState(false); // New state for tracking if captcha is needed
  const [keepBrowserOpen, setKeepBrowserOpen] = useState(false); // New state for keeping browser open

  // Initialize form with years and districts
  useEffect(() => {
    async function initializeForm() {
      setInitializing(true);
      try {
        const response = await axios.get('http://localhost:3000/initialize');
        if (response.data.success) {
          setYears(response.data.years || []);
          setDistricts(response.data.districts || []);
        } else {
          setError(response.data.message || 'Failed to initialize form');
        }
      } catch (error) {
        setError(`Error initializing form: ${error.message}`);
      } finally {
        setInitializing(false);
      }
    }

    initializeForm();
  }, []);

  // Fetch talukas when district changes
  useEffect(() => {
    async function fetchTalukas() {
      if (!formData.district) {
        setTalukas([]);
        return;
      }
      
      setLoading(true);
      try {
        const response = await axios.get(`http://localhost:3000/talukas/${formData.district}`);
        if (response.data.success) {
          const filteredTalukas = response.data.talukas ? response.data.talukas
            .filter(taluka => taluka.value !== "---Select Tahsil----")
            .map(taluka => ({
              ...taluka,
              originalValue: taluka.value, // Store original value with spaces
              value: taluka.value.trim()   // Use trimmed value for selection
            })) : [];
          
          setTalukas(filteredTalukas);
          
          // Clear current taluka and village when district changes
          setFormData(prev => ({
            ...prev,
            taluka: "",
            village: ""
          }));
        } else {
          setError(response.data.message || 'Failed to fetch talukas');
        }
      } catch (error) {
        setError(`Error fetching talukas: ${error.message}`);
      } finally {
        setLoading(false);
      }
    }

    fetchTalukas();
  }, [formData.district]);

  // Fetch villages when taluka changes
  useEffect(() => {
    async function fetchVillages() {
      if (!formData.district || !formData.taluka) {
        setVillages([]);
        return;
      }
      
      setLoading(true);
      
      try {
        const response = await axios.get(
          `http://localhost:3000/villages/${formData.district}/${formData.taluka}`
        );
        
        if (response.data.success) {
          const filteredVillages = response.data.villages ? response.data.villages.filter(
            village => village.value !== "---Select Village----"
          ) : [];
          
          setVillages(filteredVillages);
          
          // Reset current village selection when taluka changes
          setFormData(prev => ({
            ...prev,
            village: filteredVillages.length > 0 ? filteredVillages[0].value : ""
          }));
        } else {
          setError(response.data.message || 'Failed to fetch villages');
        }
      } catch (error) {
        setError(`Error fetching villages: ${error.message}`);
      } finally {
        setLoading(false);
      }
    }

    fetchVillages();
  }, [formData.district, formData.taluka]);

  // Handle input change
  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    
    if (name === 'propertyNo' && value && formData.village) {
      console.log('Property number entered, captcha may be required soon');
    }
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    
    console.log('Form submitted, sending request to backend...');
    
    try {
      console.log('Submitting form data:', formData);
      const response = await axios.post('http://localhost:3000/search', {
        ...formData,
        keepBrowserOpen: true // Always request to keep browser open
      });
      console.log('Search response received from backend:', response.data);
      
      if (response.data.captchaRequired) {
        console.log('CAPTCHA required by backend, setting state...');
        setCaptchaRequired(true);
        setKeepBrowserOpen(true); // Set flag to keep browser open
        console.log('CAPTCHA state set to:', true);
        setError('Please enter the CAPTCHA to continue');
  
        // Check if the CAPTCHA image exists by making a test request
        try {
          console.log('Checking if CAPTCHA image exists at: http://localhost:3000/captcha-image');
          const imageTestResponse = await axios.head('http://localhost:3000/captcha-image');
          console.log('CAPTCHA image exists, status:', imageTestResponse.status);
        } catch (imgError) {
          console.error('Error checking CAPTCHA image:', imgError);
        }
      } else if (response.data.success) {
        console.log('Search successful, setting result...');
        setResult(response.data.result);
        setCaptchaRequired(false);
        setKeepBrowserOpen(false); // Allow browser to close if no CAPTCHA is needed
      } else {
        console.log('Search failed:', response.data.message);
        setError(response.data.message || 'Search failed');
      }
    } catch (error) {
      console.error('Error during search request:', error);
      setError(`Error during search: ${error.message}`);
    } finally {
      setLoading(false);
      console.log('Loading state set to false');
    }
  };

  // Handle captcha submission
  const handleCaptchaSubmit = async (e) => {
    e.preventDefault();
    if (!formData.captcha.trim()) {
      setError('Please enter the CAPTCHA value');
      return;
    }
    
    setLoading(true);
    try {
      console.log('Submitting CAPTCHA:', formData.captcha);
      
      const response = await axios.post('http://localhost:3000/submit-captcha', {
        captcha: formData.captcha.trim(),
        closeBrowser: false // Request to keep browser open while viewing results
      });
      
      console.log('CAPTCHA submission response:', response.data);
      
      if (response.data.success) {
        setResult(response.data);
        setCaptchaRequired(false);
        // Note: We're NOT setting keepBrowserOpen to false here
        // so the browser stays open after successful CAPTCHA submission
      } else if (response.data.captchaRequired) {
        setError(response.data.message || 'Incorrect CAPTCHA, please try again');
        
        // Clear captcha field for re-entry
        setFormData(prev => ({...prev, captcha: ''}));
        
        // Load a fresh CAPTCHA image without timestamp
        const captchaImg = document.querySelector('.captcha-image');
        if (captchaImg) {
          captchaImg.src = `http://localhost:3000/captcha-image`;
        }
      } else {
        setError(response.data.message || 'Search failed');
      }
    } catch (error) {
      console.error('Error submitting CAPTCHA:', error);
      setError(`Error submitting CAPTCHA: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container">
      <h2>IGR Maharashtra Document Search</h2>
      
      {error && <div className="error-message">{error}</div>}
      
      {initializing ? (
        <p>Loading form data...</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Year</label>
            <select 
              name="year" 
              onChange={handleChange} 
              value={formData.year}
              disabled={loading}
            >
              {years.map((year, index) => (
                <option key={index} value={year.value}>{year.text}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>District</label>
            <select 
              name="district" 
              onChange={handleChange} 
              value={formData.district}
              disabled={loading}
            >
              <option value="">-- Select District --</option>
              {districts.map((district, index) => (
                <option key={index} value={district.value}>{district.text}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Taluka</label>
            <select 
              name="taluka" 
              onChange={handleChange} 
              value={formData.taluka.trim()} // Use trimmed value for UI matching
              disabled={loading || !formData.district}
            >
              <option value="">-- Select Taluka --</option>
              {talukas.map((taluka, index) => (
                <option key={index} value={taluka.value}>
                  {taluka.text} ({taluka.value})
                </option>
              ))}
            </select>
            {formData.taluka && 
              <div className="selection-info">
                <div>Selected taluka: {talukas.find(t => t.value === formData.taluka.trim())?.text}</div>
                <div className="debug-value">Value: "{formData.taluka}"</div>
              </div>
            }
          </div>

          <div className="form-group">
            <label>Village</label>
            <select 
              name="village" 
              onChange={handleChange} 
              value={formData.village}
              disabled={loading || !formData.taluka}
            >
              <option value="">-- Select Village --</option>
              {villages.map((village, index) => (
                <option key={index} value={village.value}>
                  {village.text} {formData.village === village.value ? '(Selected)' : ''}
                </option>
              ))}
            </select>
            {formData.village && 
              <div className="selection-info">
                Selected village: {villages.find(v => v.value === formData.village)?.text} (value: {formData.village})
              </div>
            }
          </div>

          <div className="form-group">
            <label>Property Number</label>
            <input 
              type="text" 
              name="propertyNo" 
              value={formData.propertyNo}
              onChange={handleChange}
              placeholder="Enter property number"
              disabled={loading}
              required 
            />
          </div>

          {/* Add CAPTCHA section - only shown when required */}
          {captchaRequired && (
            <CaptchaSection 
              formData={formData} 
              handleChange={handleChange} 
              handleCaptchaSubmit={handleCaptchaSubmit} 
              loading={loading}
            />
          )}

          <button type="submit" disabled={loading || !formData.village || captchaRequired}>
            {loading ? "Processing..." : "Search"}
          </button>
        </form>
      )}
      
      {result && (
        <div className="results-container">
          <h3>Search Results</h3>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

// First, update the CaptchaSection component to properly display the CAPTCHA
function CaptchaSection({ formData, handleChange, handleCaptchaSubmit, loading }) {
  const [captchaImgLoaded, setCaptchaImgLoaded] = useState(false);
  const [captchaImgUrl, setCaptchaImgUrl] = useState('http://localhost:3000/captcha-image');

  useEffect(() => {
    console.log('CaptchaSection rendered');
    
    // Use a simple URL without timestamp to avoid caching issues
    setCaptchaImgUrl(`http://localhost:3000/captcha-image`);
    
    // Simple test to check if the image is accessible
    fetch('http://localhost:3000/captcha-image')
      .then(response => {
        console.log('CAPTCHA image fetch status:', response.status);
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        setCaptchaImgLoaded(true);
        return response;
      })
      .then(() => console.log('CAPTCHA image fetch succeeded'))
      .catch(error => console.error('CAPTCHA image fetch failed:', error));
  }, []);

  return (
    <div className="captcha-section">
      <h4>Enter CAPTCHA text</h4>
      <div className="captcha-container">
        <img 
          src={captchaImgUrl}
          alt="CAPTCHA" 
          className="captcha-image"
          onLoad={() => setCaptchaImgLoaded(true)}
          onError={() => console.error("CAPTCHA image failed to load")}
        />
      </div>
      <div className="captcha-input-container">
        <input
          type="text"
          value={formData.captcha || ''}
          onChange={handleChange}
          name="captcha"
          placeholder="Enter CAPTCHA text"
          className="captcha-input"
          autoComplete="off"
          maxLength="6"
          autoFocus
        />
        <button 
          type="button"
          onClick={handleCaptchaSubmit}
          disabled={loading || !formData.captcha.trim()}
          className={`captcha-submit-button ${formData.captcha.trim() ? 'active' : ''}`}
        >
          {loading ? "Processing..." : "Submit CAPTCHA"}
        </button>
      </div>
    </div>
  );
}

export default App;
