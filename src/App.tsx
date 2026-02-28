import React, { useState, useRef } from 'react';
import Tesseract from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
// Use a runtime URL for the PDF.js worker (compatible with Vite + TypeScript)
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { UploadCloud, FileImage, Loader2, CheckCircle2, AlertCircle, RefreshCw, Copy, ClipboardCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

// Set up PDF.js worker using Vite's URL import
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

interface PassportData {
  passportNumber: string;
  fullName: string;
  surname: string;
  givenNames: string;
  nationality: string;
  dateOfBirth: string;
  sex: string;
  dateOfExpiry: string;
  mrzLine1: string;
  mrzLine2: string;
}

export default function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string>('');
  const [passportData, setPassportData] = useState<PassportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const copyToClipboard = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  const copyAllData = () => {
    if (!passportData) return;
    const data = {
      fullName: passportData.fullName,
      surname: passportData.surname,
      givenNames: passportData.givenNames,
      passportNumber: passportData.passportNumber,
      nationality: passportData.nationality,
      dateOfBirth: passportData.dateOfBirth,
      sex: passportData.sex,
      dateOfExpiry: passportData.dateOfExpiry,
      mrzLine1: passportData.mrzLine1,
      mrzLine2: passportData.mrzLine2,
    };
    copyToClipboard(JSON.stringify(data, null, 2), '_all');
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
      processFile(file);
    } else {
      setError('Please drop a valid image or PDF file.');
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const processFile = (file: File) => {
    setError(null);
    setPassportData(null);
    setSelectedFile(file);
    
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreviewUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const convertPdfToImages = async (file: File): Promise<string[]> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const images: string[] = [];
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 }); // 2.0 scale for better OCR
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (!context) continue;
      
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      await page.render({ canvasContext: context, viewport }).promise;
      images.push(canvas.toDataURL('image/jpeg', 0.8));
    }
    
    return images;
  };

  const extractMRZ = (text: string): string[] | null => {
    const lines = text.split('\n').map(l => 
      l.toUpperCase()
       .replace(/\s/g, '')
       .replace(/«/g, '<<')
       .replace(/\[/g, '<')
       .replace(/\]/g, '<')
       .replace(/\(/g, '<')
       .replace(/\)/g, '<')
    );
    
    for (let i = 0; i < lines.length - 1; i++) {
      let l1 = lines[i];
      let l2 = lines[i+1];
      
      if (l1.startsWith('P') && l1.length >= 40 && l2.length >= 40) {
        l1 = l1.padEnd(44, '<').substring(0, 44);
        l2 = l2.padEnd(44, '<').substring(0, 44);
        
        const l2Numbers = (l2.match(/[0-9]/g) || []).length;
        if (l2Numbers > 5) {
           return [l1, l2];
        }
      }
    }
    
    const continuous = lines.join('');
    const match = continuous.match(/(P[A-Z<][A-Z0-9<]{42})([A-Z0-9<]{44})/);
    if (match) {
      return [match[1], match[2]];
    }
    
    return null;
  };

  const cleanMRZLine1 = (line: string): string => {
    // MRZ Line 1 format: P<CCCNNNNN<<NNNNN<<<<<<... (44 chars)
    // Safety net: OCR may misread '<' as 'C','E','L','A' (visually similar in OCR-B font)
    if (line.length < 44) return line;

    const nameSection = line.substring(5); // After P<CCC (type + issuing country)

    // If a proper << separator already exists between letter sequences, line is fine
    if (/[A-Z]<<[A-Z]/.test(nameSection)) return line;
    if (/[A-Z]<<$/.test(nameSection) || /^<</.test(nameSection)) return line;

    let cleaned = nameSection;

    // Step 1: Restore trailing filler — any run of 3+ chars from {C,E,L,A} at the end
    // is almost certainly misread '<' padding (real names rarely end with 3+ of these)
    cleaned = cleaned.replace(/[CELA]{3,}$/, match => '<'.repeat(match.length));

    // Step 2: Restore '<<' separator between surname and given names
    // Find 'CC' between letter sequences — this is the misread '<<' separator
    // We look for CC that has letters on both sides (surname CC givennames)
    if (!/[A-Z]<<[A-Z]/.test(cleaned)) {
      cleaned = cleaned.replace(/([A-Z])CC([A-Z])/, '$1<<$2');
    }

    return line.substring(0, 5) + cleaned;
  };

  const parseMRZ = (lines: string[]): PassportData => {
    const [line1Raw, line2] = lines;

    // Clean line 1 to fix OCR misreads of '<' as 'C' etc.
    const line1 = cleanMRZLine1(line1Raw);
    
    const issuingCountry = line1.substring(2, 5).replace(/</g, '');
    const nameString = line1.substring(5).split('<<');
    const surname = nameString[0].replace(/</g, ' ').trim();
    const givenNames = (nameString[1] || '').replace(/</g, ' ').trim();
    
    const passportNumber = line2.substring(0, 9).replace(/</g, '');
    const nationality = line2.substring(10, 13).replace(/</g, '');
    const dobRaw = line2.substring(13, 19);
    const sexRaw = line2.substring(20, 21);
    const expiryRaw = line2.substring(21, 27);
    
    const formatMRZDate = (yymmdd: string) => {
      if (!yymmdd || yymmdd.length !== 6 || yymmdd.includes('<')) return '';
      // Fix common OCR number typos
      const clean = yymmdd.replace(/O/g, '0').replace(/I/g, '1').replace(/S/g, '5').replace(/Z/g, '2');
      const year = parseInt(clean.substring(0, 2), 10);
      const month = clean.substring(2, 4);
      const day = clean.substring(4, 6);
      
      if (isNaN(year)) return clean;
      
      const currentYear = new Date().getFullYear() % 100;
      const fullYear = year > currentYear + 10 ? 1900 + year : 2000 + year;
      return `${fullYear}-${month}-${day}`;
    };

    const fullName = [givenNames, surname].filter(Boolean).join(' ');

    return {
      passportNumber,
      fullName,
      surname,
      givenNames,
      nationality: nationality || issuingCountry,
      dateOfBirth: formatMRZDate(dobRaw),
      sex: sexRaw === 'M' ? 'Male' : sexRaw === 'F' ? 'Female' : 'Unspecified',
      dateOfExpiry: formatMRZDate(expiryRaw),
      mrzLine1: line1, // cleaned version
      mrzLine2: line2
    };
  };

  // --- Image preprocessing for MRZ accuracy ---

  const otsuThreshold = (values: number[]): number => {
    const histogram = new Array(256).fill(0);
    for (const v of values) histogram[v]++;
    const total = values.length;
    let sumAll = 0;
    for (let i = 0; i < 256; i++) sumAll += i * histogram[i];
    let sumBg = 0, weightBg = 0, maxVariance = 0, best = 128;
    for (let t = 0; t < 256; t++) {
      weightBg += histogram[t];
      if (weightBg === 0) continue;
      const weightFg = total - weightBg;
      if (weightFg === 0) break;
      sumBg += t * histogram[t];
      const meanBg = sumBg / weightBg;
      const meanFg = (sumAll - sumBg) / weightFg;
      const variance = weightBg * weightFg * (meanBg - meanFg) ** 2;
      if (variance > maxVariance) {
        maxVariance = variance;
        best = t;
      }
    }
    return best;
  };

  const preprocessImageForMRZ = (imageSrc: string, cropBottom: boolean): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;

        if (cropBottom) {
          // Crop bottom 35% where MRZ typically lives
          const cropHeight = Math.floor(img.height * 0.35);
          const cropY = img.height - cropHeight;
          canvas.width = img.width;
          canvas.height = cropHeight;
          ctx.drawImage(img, 0, cropY, img.width, cropHeight, 0, 0, img.width, cropHeight);
        } else {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx.drawImage(img, 0, 0);
        }

        // Convert to grayscale + Otsu binarization
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const { data } = imageData;
        const grayValues: number[] = [];
        for (let i = 0; i < data.length; i += 4) {
          grayValues.push(Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]));
        }
        const threshold = otsuThreshold(grayValues);
        for (let i = 0; i < data.length; i += 4) {
          const bw = grayValues[i / 4] < threshold ? 0 : 255;
          data[i] = bw;
          data[i + 1] = bw;
          data[i + 2] = bw;
        }
        ctx.putImageData(imageData, 0, 0);

        // Scale up 3x for better OCR on small MRZ text
        const scaled = document.createElement('canvas');
        const sCtx = scaled.getContext('2d')!;
        scaled.width = canvas.width * 3;
        scaled.height = canvas.height * 3;
        sCtx.imageSmoothingEnabled = false;
        sCtx.drawImage(canvas, 0, 0, scaled.width, scaled.height);

        resolve(scaled.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Failed to load image for preprocessing'));
      img.src = imageSrc;
    });
  };

  // --- Main extraction with MRZ-optimized OCR ---

  const extractData = async () => {
    if (!selectedFile || !previewUrl) return;

    setIsProcessing(true);
    setError(null);
    setProgressMsg('Initializing OCR engine...');

    try {
      let imageSrcs: string[] = [];
      
      if (selectedFile.type === 'application/pdf') {
        setProgressMsg('Converting PDF to images...');
        imageSrcs = await convertPdfToImages(selectedFile);
      } else {
        imageSrcs = [previewUrl];
      }

      // Create a Tesseract worker with MRZ character whitelist.
      // This is the key to accuracy: by restricting recognized characters to
      // only A-Z, 0-9, and '<', Tesseract will correctly read '<' instead of
      // misidentifying it as C, E, L, A, etc.
      let currentPage = 0;
      const totalPages = imageSrcs.length;
      const worker = await Tesseract.createWorker('eng', 1, {
        logger: (m: any) => {
          if (m.status === 'recognizing text') {
            setProgressMsg(`Scanning page ${currentPage + 1} of ${totalPages}: ${Math.round(m.progress * 100)}%`);
          }
        }
      });
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
      });

      let foundData: PassportData | null = null;

      for (let i = 0; i < imageSrcs.length; i++) {
        currentPage = i;
        let mrzLines: string[] | null = null;

        // Pass 1: Enhanced full image (handles already-cropped MRZ images)
        setProgressMsg(`Enhancing page ${i + 1}...`);
        try {
          const enhancedFull = await preprocessImageForMRZ(imageSrcs[i], false);
          const result = await worker.recognize(enhancedFull);
          mrzLines = extractMRZ(result.data.text);
        } catch { /* continue to next pass */ }

        // Pass 2: Enhanced + cropped to bottom 35% (for full passport page images)
        if (!mrzLines) {
          setProgressMsg(`Scanning MRZ region of page ${i + 1}...`);
          try {
            const enhancedCropped = await preprocessImageForMRZ(imageSrcs[i], true);
            const result = await worker.recognize(enhancedCropped);
            mrzLines = extractMRZ(result.data.text);
          } catch { /* continue to next pass */ }
        }

        // Pass 3: Original image as fallback (in case preprocessing degrades quality)
        if (!mrzLines) {
          setProgressMsg(`Scanning page ${i + 1} (original)...`);
          const result = await worker.recognize(imageSrcs[i]);
          mrzLines = extractMRZ(result.data.text);
        }

        if (mrzLines) {
          foundData = parseMRZ(mrzLines);
          break;
        }
      }

      await worker.terminate();

      if (foundData) {
        setPassportData(foundData);
      } else {
        throw new Error('Could not detect a valid Machine Readable Zone (MRZ). Please ensure the image is clear and the bottom two lines of the passport are visible.');
      }
    } catch (err: any) {
      console.error('Extraction error:', err);
      setError(err.message || 'An error occurred while processing the passport.');
    } finally {
      setIsProcessing(false);
      setProgressMsg('');
    }
  };

  const reset = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setPassportData(null);
    setError(null);
    setProgressMsg('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">Passport to Data</h1>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto">
            Upload a passport image or PDF to instantly extract structured data locally using Tesseract OCR. No data leaves your browser.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* Left Column: Upload & Preview */}
          <Card className="shadow-md border-slate-200">
            <CardHeader>
              <CardTitle>Passport Document</CardTitle>
              <CardDescription>Upload a clear photo, scan, or PDF of the passport.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!previewUrl ? (
                <div
                  className="border-2 border-dashed border-slate-300 rounded-xl p-12 text-center hover:bg-slate-50 transition-colors cursor-pointer flex flex-col items-center justify-center space-y-4"
                  onClick={() => fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                >
                  <div className="bg-blue-50 p-4 rounded-full">
                    <UploadCloud className="w-8 h-8 text-blue-600" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-slate-900">Click to upload or drag and drop</p>
                    <p className="text-xs text-slate-500">SVG, PNG, JPG, GIF or PDF (max. 10MB)</p>
                  </div>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-100 aspect-[4/3] flex items-center justify-center">
                    {selectedFile?.type === 'application/pdf' ? (
                      <iframe
                        src={previewUrl}
                        title="PDF preview"
                        className="w-full h-full"
                      />
                    ) : (
                      <img
                        src={previewUrl}
                        alt="Passport preview"
                        className="max-w-full max-h-full object-contain"
                        referrerPolicy="no-referrer"
                      />
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-sm text-slate-600">
                      <FileImage className="w-4 h-4" />
                      <span className="truncate max-w-[200px]">{selectedFile?.name}</span>
                    </div>
                    <Button variant="outline" size="sm" onClick={reset} disabled={isProcessing}>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Change File
                    </Button>
                  </div>
                </div>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </CardContent>
            <CardFooter>
              <Button
                className="w-full"
                size="lg"
                onClick={extractData}
                disabled={!previewUrl || isProcessing || !!passportData}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    {progressMsg || 'Extracting Data...'}
                  </>
                ) : passportData ? (
                  <>
                    <CheckCircle2 className="mr-2 h-5 w-5" />
                    Extraction Complete
                  </>
                ) : (
                  'Extract Data (Local OCR)'
                )}
              </Button>
            </CardFooter>
          </Card>

          {/* Right Column: Extracted Data */}
          <Card className="shadow-md border-slate-200 h-full">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Extracted Details</span>
                <div className="flex items-center gap-2">
                  {passportData && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={copyAllData}
                      className="text-xs h-7"
                    >
                      {copiedField === '_all' ? (
                        <><ClipboardCheck className="w-3 h-3 mr-1" />Copied!</>
                      ) : (
                        <><Copy className="w-3 h-3 mr-1" />Copy All</>
                      )}
                    </Button>
                  )}
                  {passportData && <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100">MRZ Parsed</Badge>}
                </div>
              </CardTitle>
              <CardDescription>Data parsed from the Machine Readable Zone (MRZ).</CardDescription>
            </CardHeader>
            <CardContent>
              {!previewUrl && !passportData && !isProcessing && (
                <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-slate-400 space-y-4">
                  <FileImage className="w-12 h-12 opacity-20" />
                  <p className="text-sm">Upload a file to see extracted data</p>
                </div>
              )}

              {isProcessing && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-10 w-full" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-20 w-full" />
                  </div>
                </div>
              )}

              {passportData && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  {/* Full Name — single column spanning full width */}
                  <DataField label="Full Name" value={passportData.fullName} highlight onCopy={() => copyToClipboard(passportData.fullName, 'fullName')} copied={copiedField === 'fullName'} />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <DataField label="Surname" value={passportData.surname} onCopy={() => copyToClipboard(passportData.surname, 'surname')} copied={copiedField === 'surname'} />
                    <DataField label="Given Names" value={passportData.givenNames} onCopy={() => copyToClipboard(passportData.givenNames, 'givenNames')} copied={copiedField === 'givenNames'} />
                    <DataField label="Passport Number" value={passportData.passportNumber} highlight onCopy={() => copyToClipboard(passportData.passportNumber, 'passportNumber')} copied={copiedField === 'passportNumber'} />
                    <DataField label="Nationality" value={passportData.nationality} onCopy={() => copyToClipboard(passportData.nationality, 'nationality')} copied={copiedField === 'nationality'} />
                    <DataField label="Date of Birth" value={passportData.dateOfBirth} onCopy={() => copyToClipboard(passportData.dateOfBirth, 'dob')} copied={copiedField === 'dob'} />
                    <DataField label="Sex" value={passportData.sex} onCopy={() => copyToClipboard(passportData.sex, 'sex')} copied={copiedField === 'sex'} />
                    <DataField label="Date of Expiry" value={passportData.dateOfExpiry} highlight onCopy={() => copyToClipboard(passportData.dateOfExpiry, 'expiry')} copied={copiedField === 'expiry'} />
                  </div>

                  {(passportData.mrzLine1 || passportData.mrzLine2) && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-slate-500 uppercase tracking-wider">Machine Readable Zone (MRZ)</Label>
                          <button
                            onClick={() => copyToClipboard(`${passportData.mrzLine1}\n${passportData.mrzLine2}`, 'mrz')}
                            className="text-slate-400 hover:text-slate-200 transition-colors p-1 rounded"
                            title="Copy MRZ"
                          >
                            {copiedField === 'mrz' ? <ClipboardCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                        <div className="bg-slate-900 rounded-md p-4 font-mono text-emerald-400 text-xs sm:text-sm overflow-x-auto whitespace-pre">
                          {passportData.mrzLine1 && <div>{passportData.mrzLine1}</div>}
                          {passportData.mrzLine2 && <div>{passportData.mrzLine2}</div>}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function DataField({ label, value, highlight = false, onCopy, copied = false }: {
  label: string;
  value: string;
  highlight?: boolean;
  onCopy?: () => void;
  copied?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-500 uppercase tracking-wider">{label}</Label>
      <div className={`group relative flex items-center justify-between gap-2 px-3 py-2 rounded-md border ${
        highlight
          ? 'bg-blue-50 border-blue-200 text-blue-900 font-medium'
          : 'bg-slate-50 border-slate-200 text-slate-900'
      }`}>
        <span className="truncate">{value || <span className="text-slate-400 italic">Not found</span>}</span>
        {onCopy && value && (
          <button
            onClick={onCopy}
            className="shrink-0 text-slate-400 hover:text-slate-700 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
            title={`Copy ${label}`}
          >
            {copied ? <ClipboardCheck className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}
