// Cloudflare Worker for Finance Platform
// Calculates minimum profit with credit score-based benchmark margins in INR

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

// Define environment variables for Mistral AI API
const MISTRAL_API_KEY = "YOUR_API_KEY_HERE"; // User provided Mistral AI API key
const MISTRAL_API_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"; // OpenRouter endpoint for Mistral AI
const MISTRAL_MODEL = "mistralai/mistral-small-3.2-24b-instruct"; // User provided model name

// Function for calling Mistral AI for general purposes (e.g., negotiation)
async function callMistralAI(messages) {
  try {
    const response = await fetch(MISTRAL_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: MISTRAL_MODEL,
        messages: messages,
        temperature: 0.7,
        max_tokens: 500,
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Mistral AI API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  } catch (error) {
    console.error("Error calling Mistral AI:", error);
    throw error;
  }
}

// Function for calling Mistral AI for master agent oversight
async function callMasterAgentAI(loanDetails) {
  const prompt = `You are a master agent overseeing loan applications. Your task is to identify only *critical problems and abnormalities* in the provided loan application details that are truly unrealistic or nonsensical, suggesting potential fraud or severe user error. Do not flag minor discrepancies or values that are merely unusual but still plausible.

  Loan Application Details:
  - Principal Amount: ${loanDetails.principal} INR
  - Proposed Interest Rate: ${loanDetails.interestRate}%
  - Credit Score: ${loanDetails.creditScore}
  - Annual Salary: ${loanDetails.salary} INR
  - Time Period (in months): ${loanDetails.timeInMonths}

  Specifically look for:
  - **Extremely unrealistic interest rates:** e.g., 1000% or 0.01% (unless the principal is also extremely low, making it plausible).
  - **Grossly disproportionate salary to principal:** e.g., a salary of 88 INR for a principal of 1,00,000 INR.
  - **Credit scores outside the 300-900 range, or values like 0 or negative.**
  - **Principal amounts that are extremely high or low beyond any reasonable loan request, or negative.**
  - **Loan durations (time in months) that are absurdly short (e.g., 0 or 1 month for a large loan) or excessively long (e.g., 1000+ months).**

  If you detect a *critical problem or abnormality*, provide a concise warning message explaining the issue. If there are multiple critical issues, list them. If the data seems reasonable and does not contain any critical or ridiculous flaws, respond *only* with the text "OK".

  Example of a critical warning: "Warning: Unrealistic interest rate (1000%). This is highly suspicious and requires immediate review."
  Example of another critical warning: "Warning: Annual Salary (88 INR) is critically low for a principal amount of ${loanDetails.principal} INR. This suggests a potential data entry error or fraudulent attempt."
  Example of an acceptable response: "OK"
  `

  try {
    const response = await fetch(MISTRAL_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MISTRAL_API_KEY}`
      },
      body: JSON.stringify({
        model: MISTRAL_MODEL, // Using the same model for consistency
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2, // Lower temperature for more factual/less creative responses
        max_tokens: 150,
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Master Agent AI API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.error("Error calling Master Agent AI:", error);
    return `Error: Could not perform master agent oversight. Details: ${error.message}`;
  }
}


async function handleRequest(request) {
  // Set CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  }

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // Handle POST requests
  if (request.method === 'POST') {
    try {
      const body = await request.json()
      const { principal, interestRate, creditScore, salary, timeInMonths, negotiatorPara, negotiationMessage, conversationHistory } = body

      // Validate inputs
      if (principal === undefined || interestRate === undefined || creditScore === undefined || salary === undefined) {
        return new Response(JSON.stringify({
          error: 'Missing required fields: principal, interestRate, creditScore, salary',
          providedFields: {
            principal: principal !== undefined,
            interestRate: interestRate !== undefined,
            creditScore: creditScore !== undefined,
            salary: salary !== undefined
          }
        }), { 
          status: 400, 
          headers: corsHeaders 
        })
      }

      // Type validation
      if (typeof principal !== 'number' || typeof interestRate !== 'number' || 
          typeof creditScore !== 'number' || typeof salary !== 'number') {
        return new Response(JSON.stringify({
          error: 'All fields must be numbers',
          types: {
            principal: typeof principal,
            interestRate: typeof interestRate,
            creditScore: typeof creditScore,
            salary: typeof salary
          }
        }), { 
          status: 400, 
          headers: corsHeaders 
        })
      }

      if (principal <= 0) {
        return new Response(JSON.stringify({
          error: 'Principal must be a positive number',
          provided: principal
        }), { 
          status: 400, 
          headers: corsHeaders 
        })
      }

      if (interestRate < 0) {
        return new Response(JSON.stringify({
          error: 'Interest rate cannot be negative',
          provided: interestRate
        }), { 
          status: 400, 
          headers: corsHeaders 
        })
      }

      if (salary <= 0) {
        return new Response(JSON.stringify({
          error: 'Salary must be a positive number',
          provided: salary
        }), { 
          status: 400, 
          headers: corsHeaders 
        })
      }

      if (creditScore < 300 || creditScore > 900) {
        return new Response(JSON.stringify({
          error: 'Credit score must be between 300 and 900',
          provided: creditScore
        }), { 
          status: 400, 
          headers: corsHeaders 
        })
      }

      // Validate timeInMonths if provided
      const timeMonths = timeInMonths || 12
      if (timeMonths <= 0) {
        return new Response(JSON.stringify({
          error: 'Time in months must be a positive number',
          provided: timeMonths
        }), { 
          status: 400, 
          headers: corsHeaders 
        })
      }

      // Master Agent Oversight
      const loanDetailsForAgent = { principal, interestRate, creditScore, salary, timeInMonths };
      const agentFeedback = await callMasterAgentAI(loanDetailsForAgent);

      if (agentFeedback !== "OK") {
        return new Response(JSON.stringify({
          error: 'Master Agent Warning',
          message: agentFeedback,
          details: 'Please review your loan application details.'
        }), {
          status: 400,
          headers: corsHeaders
        });
      }

      // First, always calculate the initial offer
      const initialResult = calculateCreditBasedProfit(principal, interestRate, creditScore, salary, timeMonths)
      
      // Check if this is a negotiation request
      let result
      if (negotiationMessage) {
        // LLM-driven negotiation
        const systemMessage = `You are an AI loan negotiator for a finance platform. Your goal is to adjust the interest rate (R) and time in months (T) to help the user's loan offer meet or exceed the benchmark profit requirement. The principal (P) CANNOT be changed.
        
        Current Loan Details:
        - Principal (P): ${principal} INR
        - Proposed Interest Rate (R): ${interestRate}%
        - Time in Months (T): ${timeMonths}
        - Credit Score: ${creditScore}
        - Annual Salary: ${salary} INR
        - Benchmark Rate: ${initialResult.benchmarkRequirement.requiredRate}
        - Required Total Profit: ${initialResult.benchmarkRequirement.requiredTotalProfitAmount} INR
        - Proposed Total Profit: ${initialResult.userProposal.proposedTotalProfitAmount} INR
        
        The current offer DOES NOT meet the benchmark.
        
        Based on the user's negotiation message, suggest new values for R (interest rate as a number between 0 and 100) and T (time in months as a positive integer).
        You must respond with a JSON object containing 'R', 'T', and 'attemptNumber' (current attempt, starting from 1, max 3).
        Example response: {"R": 10.5, "T": 24, "attemptNumber": 1}
        Only respond with the JSON object. Do NOT include any other text.
        `
        
        const messages = conversationHistory ? [...conversationHistory] : [];
        messages.push({"role": "system", "content": systemMessage});
        messages.push({"role": "user", "content": negotiationMessage});
        
        const llmResponse = await callMistralAI(messages);
        
        let llmNegotiatorPara;
        try {
          llmNegotiatorPara = JSON.parse(llmResponse);
          if (typeof llmNegotiatorPara.R !== 'number' || typeof llmNegotiatorPara.T !== 'number' || typeof llmNegotiatorPara.attemptNumber !== 'number') {
            throw new Error('LLM response did not contain valid R, T, or attemptNumber.');
          }
        } catch (e) {
          return new Response(JSON.stringify({
            error: 'LLM returned an invalid JSON or negotiation parameters.',
            llmResponse: llmResponse,
            details: e.message
          }), {
            status: 400,
            headers: corsHeaders
          });
        }

        // Use LLM's suggested parameters for negotiation
        // P cannot be changed by LLM, so we pass the original principal
        const updatedNegotiatorPara = {
          P: principal, // Principal remains unchanged
          R: llmNegotiatorPara.R,
          T: llmNegotiatorPara.T,
          attemptNumber: llmNegotiatorPara.attemptNumber
        };
        
        result = handleNegotiation(principal, interestRate, creditScore, salary, timeMonths, updatedNegotiatorPara, initialResult)
        result.conversationHistory = [...messages, {"role": "assistant", "content": llmResponse}]; // Update history with LLM response
      } else if (negotiatorPara) {
        // Direct negotiation with negotiatorPara
        if (initialResult.evaluation.meetsRequirement) {
          return new Response(JSON.stringify({
            error: 'Negotiation not needed. Your initial offer already meets the benchmark requirement.',
            initialOffer: initialResult
          }, null, 2), {
            status: 400,
            headers: corsHeaders
          })
        }
        
        // Handle negotiation with original values as context
        result = handleNegotiation(principal, interestRate, creditScore, salary, timeInMonths, negotiatorPara, initialResult)
      } else {
        result = initialResult
      }
      
      return new Response(JSON.stringify(result, null, 2), {
        headers: corsHeaders
      })

    } catch (error) {
      return new Response(JSON.stringify({
        error: 'Invalid JSON or request format',
        details: error.message,
        stack: error.stack
      }), { 
        status: 400, 
        headers: corsHeaders 
      })
    }
  }

  // Handle GET requests - return API documentation
  if (request.method === 'GET') {
    const docs = {
      service: 'Finance Platform - Credit-Based Profit Calculator',
      currency: 'INR (Indian Rupees)',
      creditScoreCategories: {
        low: {
          range: '300-649',
          benchmarkRate: '6% per annum'
        },
        moderate: {
          range: '650-749',
          benchmarkRate: '13% per annum'
        },
        high: {
          range: '750-900',
          benchmarkRate: '20% per annum'
        }
      },
      endpoints: {
        POST: {
          path: '/',
          description: 'Calculate profit based on credit score category',
          requestBody: {
            principal: 'number (required) - Principal amount in INR',
            interestRate: 'number (required) - Proposed interest rate (%)',
            creditScore: 'number (required) - Credit score (300-900)',
            salary: 'number (required) - Annual salary in INR',
            timeInMonths: 'number (optional) - Time period in months (default: 12)'
          },
          example: {
            principal: 100000,
            interestRate: 8,
            creditScore: 720,
            salary: 600000,
            timeInMonths: 12
          }
        }
      },
      negotiation: {
        description: 'Negotiate loan terms (max 3 attempts) - Only available AFTER initial 3 options are provided',
        prerequisite: 'Initial offer must NOT meet benchmark requirement to enable negotiation',
        negotiatorPara: {
          description: 'Object containing negotiation parameters (used for direct parameter input)',
          structure: {
            P: 'number (optional) - New principal amount',
            R: 'number (optional) - New interest rate',
            T: 'number (optional) - New time in months',
            attemptNumber: 'number (required) - Current negotiation attempt (1-3)'
          },
          rules: [
            'If P is provided: Original R and T are used, system adjusts R and T to meet benchmark',
            'If R is provided: Original P and T are used, system adjusts P and T to meet benchmark (P cannot be changed, only T)',
            'If T is provided: Original P and R are used, system adjusts P and R to meet benchmark (P cannot be changed, only R)',
            'If all P, R, T provided: System processes all three values',
            'P (principal) is never manipulated in counter-offers',
            'Maximum 3 negotiation attempts allowed'
          ],
          example: {
            principal: 100000,
            interestRate: 8,
            creditScore: 720,
            salary: 600000,
            timeInMonths: 12,
            negotiatorPara: {
              R: 10,
              attemptNumber: 1
            }
          }
        },
        negotiationMessage: {
          description: 'Natural language message for LLM-driven negotiation',
          structure: {
            negotiationMessage: 'string (optional) - User\'s natural language negotiation request',
            conversationHistory: 'array (optional) - Array of message objects for LLM context'
          },
          example: {
            principal: 100000,
            interestRate: 8,
            creditScore: 720,
            salary: 600000,
            timeInMonths: 12,
            negotiationMessage: "The interest rate is too high, can you reduce it and perhaps extend the time a bit?",
            conversationHistory: [
              { "role": "system", "content": "..." },
              { "role": "user", "content": "..." }
            ]
          }
        }
      },
      usage: 'Send POST request with required fields to get credit-based profit calculations in INR'
    }

    return new Response(JSON.stringify(docs, null, 2), {
      headers: corsHeaders
    })
  }

  return new Response(JSON.stringify({
    error: 'Method not allowed. Use GET for documentation or POST for calculations.'
  }), { 
    status: 405, 
    headers: corsHeaders 
  })
}

function formatINR(amount) {
  // Format number in Indian numbering system
  const formatted = amount.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  })
  return `₹${formatted}`
}

function getCreditCategory(creditScore) {
  if (creditScore >= 300 && creditScore <= 649) {
    return {
      category: 'low',
      range: '300-649',
      benchmarkRate: 0.06,
      benchmarkRatePercent: '6%',
      description: 'Low credit category - Higher risk profile'
    }
  } else if (creditScore >= 650 && creditScore <= 749) {
    return {
      category: 'moderate',
      range: '650-749',
      benchmarkRate: 0.13,
      benchmarkRatePercent: '13%',
      description: 'Moderate credit category - Medium risk profile'
    }
  } else if (creditScore >= 750 && creditScore <= 900) {
    return {
      category: 'high',
      range: '750-900',
      benchmarkRate: 0.20,
      benchmarkRatePercent: '20%',
      description: 'High credit category - Lower risk profile'
    }
  }
}

function calculateCreditBasedProfit(principal, interestRate, creditScore, salary, timeInMonths) {
  const creditInfo = getCreditCategory(creditScore)
  const userInterestRateDecimal = interestRate / 100
  
  // Calculate user's proposed profit
  const userAnnualProfit = principal * userInterestRateDecimal
  const userMonthlyProfit = userAnnualProfit / 12
  const userTotalProfit = userMonthlyProfit * timeInMonths
  
  // Calculate benchmark profit based on credit category
  const benchmarkAnnualProfit = principal * creditInfo.benchmarkRate
  const benchmarkMonthlyProfit = benchmarkAnnualProfit / 12
  const benchmarkTotalProfit = benchmarkMonthlyProfit * timeInMonths
  
  // Check if user's rate meets or exceeds benchmark
  const meetsRequirement = userInterestRateDecimal >= creditInfo.benchmarkRate
  
  let response = {
    currency: 'INR',
    userProfile: {
      creditScore: creditScore,
      category: creditInfo.category,
      categoryRange: creditInfo.range,
      categoryDescription: creditInfo.description,
      annualSalary: formatINR(salary),
      monthlySalary: formatINR(salary / 12)
    },
    loanDetails: {
      principal: formatINR(principal),
      principalAmount: principal,
      proposedInterestRate: `${interestRate}%`,
      timeInMonths: timeInMonths,
      timeInYears: parseFloat((timeInMonths / 12).toFixed(2))
    },
    benchmarkRequirement: {
      requiredRate: creditInfo.benchmarkRatePercent,
      requiredAnnualProfit: formatINR(benchmarkAnnualProfit),
      requiredMonthlyProfit: formatINR(benchmarkMonthlyProfit),
      requiredTotalProfit: formatINR(benchmarkTotalProfit),
      requiredTotalProfitAmount: parseFloat(benchmarkTotalProfit.toFixed(2))
    },
    userProposal: {
      proposedRate: `${interestRate}%`,
      proposedAnnualProfit: formatINR(userAnnualProfit),
      proposedMonthlyProfit: formatINR(userMonthlyProfit),
      proposedTotalProfit: formatINR(userTotalProfit),
      proposedTotalProfitAmount: parseFloat(userTotalProfit.toFixed(2)),
      totalAmount: formatINR(principal + userTotalProfit),
      monthlyEMI: formatINR(calculateEMI(principal, interestRate, timeInMonths))
    },
    evaluation: {
      meetsRequirement: meetsRequirement,
      profitGap: meetsRequirement ? 0 : parseFloat((benchmarkTotalProfit - userTotalProfit).toFixed(2)),
      profitGapFormatted: meetsRequirement ? formatINR(0) : formatINR(benchmarkTotalProfit - userTotalProfit),
      message: meetsRequirement 
        ? '✓ Proposed interest rate meets or exceeds the benchmark requirement.' 
        : '✗ Proposed interest rate is below the benchmark requirement. Please review the recommended options below.'
    }
  }
  
  // If user's rate doesn't meet requirement, provide varied options
  if (!meetsRequirement) {
    const rateOptions = generateVariedRateOptions(principal, creditInfo.benchmarkRate, timeInMonths)
    const timeOptions = generateTimeOptions(principal, interestRate, creditInfo.benchmarkRate, benchmarkTotalProfit)
    
    response.recommendedOptions = {
      message: 'Here are varied options to meet or exceed the profit margin:',
      byAdjustingRate: {
        description: 'Keep the same time period, adjust interest rate',
        options: rateOptions
      },
      byAdjustingTime: {
        description: 'Keep the same interest rate, adjust time period',
        options: timeOptions
      }
    }
    
    response.negotiationAvailable = {
      available: true,
      message: 'Not satisfied with these options? You can negotiate by providing a negotiatorPara object in your next request.',
      maxAttempts: 3,
      instructions: 'Include negotiatorPara with your preferred P (principal), R (rate), or T (time) values along with attemptNumber (1-3)',
      example: {
        negotiatorPara: {
          R: 11,
          attemptNumber: 1
        }
      }
    }
  } else {
    response.negotiationAvailable = {
      available: false,
      message: 'Your offer meets the benchmark requirement. No negotiation needed.'
    }
  }
  
  return response
}

function generateVariedRateOptions(principal, benchmarkRate, timeInMonths) {
  // Generate 3 varied options: at benchmark, moderately above, significantly above
  const option1Rate = benchmarkRate // Minimum
  const option2Rate = benchmarkRate * 1.15 // 15% higher than benchmark
  const option3Rate = benchmarkRate * 1.35 // 35% higher than benchmark
  
  const options = []
  
  const rates = [
    { rate: option1Rate, label: 'Minimum Required' },
    { rate: option2Rate, label: 'Recommended' },
    { rate: option3Rate, label: 'Premium' }
  ]
  
  for (let i = 0; i < rates.length; i++) {
    const rate = rates[i].rate
    const annualProfit = principal * rate
    const monthlyProfit = annualProfit / 12
    const totalProfit = monthlyProfit * timeInMonths
    const monthlyEMI = calculateEMI(principal, rate * 100, timeInMonths)
    
    options.push({
      optionNumber: i + 1,
      optionLabel: rates[i].label,
      interestRate: `${(rate * 100).toFixed(2)}%`,
      timeInMonths: timeInMonths,
      annualProfit: formatINR(annualProfit),
      monthlyProfit: formatINR(monthlyProfit),
      totalProfit: formatINR(totalProfit),
      totalProfitAmount: parseFloat(totalProfit.toFixed(2)),
      totalAmount: formatINR(principal + totalProfit),
      monthlyEMI: formatINR(monthlyEMI)
    })
  }
  
  return options
}

function handleNegotiation(originalPrincipal, originalRate, creditScore, salary, originalTime, negotiatorPara, initialResult) {
  const { P, R, T, attemptNumber } = negotiatorPara
  
  // Validate attempt number
  if (!attemptNumber || attemptNumber < 1 || attemptNumber > 3) {
    return {
      error: 'Invalid negotiation attempt number. Must be between 1 and 3.',
      provided: attemptNumber
    }
  }
  
  if (attemptNumber > 3) {
    return {
      error: 'Maximum negotiation attempts (3) exceeded. Please proceed with one of the original offers.',
      attemptNumber: attemptNumber,
      originalOptions: initialResult.recommendedOptions
    }
  }
  
  const creditInfo = getCreditCategory(creditScore)
  
  // Determine what values to use
  let workingPrincipal = originalPrincipal
  let workingRate = originalRate
  let workingTime = originalTime
  let negotiatedParameter = null
  
  // Identify what was negotiated
  if (P !== undefined && R === undefined && T === undefined) {
    // User negotiated Principal only
    workingPrincipal = P
    negotiatedParameter = 'P'
  } else if (R !== undefined && P === undefined && T === undefined) {
    // User negotiated Rate only
    workingRate = R
    negotiatedParameter = 'R'
  } else if (T !== undefined && P === undefined && R === undefined) {
    // User negotiated Time only
    workingTime = T
    negotiatedParameter = 'T'
  } else if (P !== undefined && R !== undefined && T !== undefined) {
    // User negotiated all three
    workingPrincipal = P
    workingRate = R
    workingTime = T
    negotiatedParameter = 'ALL'
  } else if (P !== undefined || R !== undefined || T !== undefined) {
    // Multiple but not all parameters provided
    if (P !== undefined) workingPrincipal = P
    if (R !== undefined) workingRate = R
    if (T !== undefined) workingTime = T
    negotiatedParameter = 'MULTIPLE'
  }
  
  // Calculate the negotiated offer
  const negotiatedResult = calculateCreditBasedProfit(workingPrincipal, workingRate, creditScore, salary, workingTime)
  
  // Generate counter-offer only if benchmark is not met
  let counterOffer = null
  if (!negotiatedResult.evaluation.meetsRequirement) {
    counterOffer = generateCounterOffer(workingPrincipal, workingRate, workingTime, creditInfo, negotiatedParameter)
  }
  
  return {
    negotiation: {
      attemptNumber: attemptNumber,
      remainingAttempts: 3 - attemptNumber,
      negotiatedParameter: negotiatedParameter,
      status: negotiatedResult.evaluation.meetsRequirement ? 'ACCEPTED' : 'COUNTER_OFFER_SENT'
    },
    context: {
      message: 'This negotiation is in response to the initial 3 options provided',
      initialOptionsProvided: true
    },
    originalOffer: {
      principal: formatINR(originalPrincipal),
      interestRate: `${originalRate}%`,
      timeInMonths: originalTime,
      timeInYears: parseFloat((originalTime / 12).toFixed(2)),
      totalProfit: initialResult.userProposal.proposedTotalProfit,
      totalAmount: initialResult.userProposal.totalAmount,
      monthlyEMI: initialResult.userProposal.monthlyEMI,
      meetsRequirement: initialResult.evaluation.meetsRequirement
    },
    initialRecommendedOptions: {
      byAdjustingRate: initialResult.recommendedOptions.byAdjustingRate,
      byAdjustingTime: initialResult.recommendedOptions.byAdjustingTime
    },
    negotiatedOffer: {
      principal: formatINR(workingPrincipal),
      principalAmount: workingPrincipal,
      interestRate: `${workingRate}%`,
      timeInMonths: workingTime,
      timeInYears: parseFloat((workingTime / 12).toFixed(2)),
      totalProfit: negotiatedResult.userProposal.proposedTotalProfit,
      totalProfitAmount: negotiatedResult.userProposal.proposedTotalProfitAmount,
      totalAmount: negotiatedResult.userProposal.totalAmount,
      monthlyEMI: negotiatedResult.userProposal.monthlyEMI,
      meetsRequirement: negotiatedResult.evaluation.meetsRequirement,
      evaluation: negotiatedResult.evaluation
    },
    benchmarkRequirement: negotiatedResult.benchmarkRequirement,
    counterOffer: counterOffer,
    message: negotiatedResult.evaluation.meetsRequirement
      ? `✓ Negotiation successful! Your offer meets the benchmark requirement.`
      : `✗ Your negotiated offer does not meet the benchmark. Please review the counter-offer below or try again (${3 - attemptNumber} attempts remaining).`
  }
}

function generateCounterOffer(principal, rate, time, creditInfo, negotiatedParam) {
  const benchmarkRate = creditInfo.benchmarkRate
  const benchmarkAnnualProfit = principal * benchmarkRate
  const benchmarkMonthlyProfit = benchmarkAnnualProfit / 12
  const requiredTotalProfit = benchmarkMonthlyProfit * time
  
  let counterOffer = {
    description: 'Our counter-offer to meet the benchmark requirement',
    note: 'Principal amount (P) is never modified as per policy'
  }
  
  // Generate counter based on what was negotiated
  switch(negotiatedParam) {
    case 'P':
      // User wants different principal - we adjust R and T (but keep P fixed in counter)
      // Since we can't change P, we'll adjust R or T
      const newRate1 = benchmarkRate * 100
      const newTime1 = time
      
      counterOffer.offer = {
        principal: formatINR(principal),
        principalAmount: principal,
        interestRate: `${newRate1.toFixed(2)}%`,
        timeInMonths: newTime1,
        timeInYears: parseFloat((newTime1 / 12).toFixed(2)),
        adjustedParameters: ['R'],
        totalProfit: formatINR(requiredTotalProfit),
        totalAmount: formatINR(principal + requiredTotalProfit),
        monthlyEMI: formatINR(calculateEMI(principal, newRate1, newTime1))
      }
      break
      
    case 'R':
      // User wants different rate - we keep P, R fixed and adjust T
      const currentRateDecimal = rate / 100
      const currentMonthlyProfit = (principal * currentRateDecimal) / 12
      
      if (currentMonthlyProfit <= 0) {
        counterOffer.offer = {
          message: 'Cannot generate counter-offer with 0% or negative interest rate. Please increase the rate.',
          suggestedRate: `${(benchmarkRate * 100).toFixed(2)}%`
        }
      } else {
        const requiredMonths = Math.ceil(requiredTotalProfit / currentMonthlyProfit)
        
        counterOffer.offer = {
          principal: formatINR(principal),
          principalAmount: principal,
          interestRate: `${rate}%`,
          timeInMonths: requiredMonths,
          timeInYears: parseFloat((requiredMonths / 12).toFixed(2)),
          adjustedParameters: ['T'],
          totalProfit: formatINR(currentMonthlyProfit * requiredMonths),
          totalAmount: formatINR(principal + (currentMonthlyProfit * requiredMonths)),
          monthlyEMI: formatINR(calculateEMI(principal, rate, requiredMonths))
        }
      }
      break
      
    case 'T':
      // User wants different time - we keep P, T fixed and adjust R
      const requiredMonthlyProfit = requiredTotalProfit / time
      const requiredAnnualProfit = requiredMonthlyProfit * 12
      const requiredRate = (requiredAnnualProfit / principal) * 100
      
      counterOffer.offer = {
        principal: formatINR(principal),
        principalAmount: principal,
        interestRate: `${requiredRate.toFixed(2)}%`,
        timeInMonths: time,
        timeInYears: parseFloat((time / 12).toFixed(2)),
        adjustedParameters: ['R'],
        totalProfit: formatINR(requiredTotalProfit),
        totalAmount: formatINR(principal + requiredTotalProfit),
        monthlyEMI: formatINR(calculateEMI(principal, requiredRate, time))
      }
      break
      
    case 'ALL':
    case 'MULTIPLE':
      // User negotiated multiple params - adjust R to meet benchmark at given P and T
      const reqMonthlyProfit = requiredTotalProfit / time
      const reqAnnualProfit = reqMonthlyProfit * 12
      const reqRate = (reqAnnualProfit / principal) * 100
      
      counterOffer.offer = {
        principal: formatINR(principal),
        principalAmount: principal,
        interestRate: `${reqRate.toFixed(2)}%`,
        timeInMonths: time,
        timeInYears: parseFloat((time / 12).toFixed(2)),
        adjustedParameters: ['R'],
        totalProfit: formatINR(requiredTotalProfit),
        totalAmount: formatINR(principal + requiredTotalProfit),
        monthlyEMI: formatINR(calculateEMI(principal, reqRate, time))
      }
      break
      
    default:
      counterOffer.offer = {
        message: 'Unable to generate counter-offer. Please specify negotiation parameters.'
      }
  }
  
  return counterOffer
}

function generateTimeOptions(principal, currentRate, benchmarkRate, requiredProfit) {
  const currentRateDecimal = currentRate / 100
  
  // If current rate is 0, we can't generate time options
  if (currentRateDecimal === 0) {
    return [{
      message: 'Cannot calculate time options with 0% interest rate. Please use rate adjustment options above.'
    }]
  }
  
  // Calculate the annual profit at the current rate
  const annualProfitAtCurrentRate = principal * currentRateDecimal;
  const monthlyProfitAtCurrentRate = annualProfitAtCurrentRate / 12;

  // Calculate the base months needed to meet the required profit at the current rate
  const baseMonthsNeeded = monthlyProfitAtCurrentRate > 0 ? Math.ceil(requiredProfit / monthlyProfitAtCurrentRate) : 1;

  // Generate 3 distinct time-based options with fixed relationships to baseMonthsNeeded
  // Ensure they are always different and cover a range
  const shortTermMonths = Math.max(6, Math.floor(baseMonthsNeeded * 0.5)); // Shorter than base
  const mediumTermMonths = baseMonthsNeeded; // Close to base (or the minimum to meet profit at current rate)
  const longTermMonths = Math.ceil(baseMonthsNeeded * 2); // Longer than base

  // Create an array of these specific time options
  const timeOptions = [
    { months: shortTermMonths, label: 'Shorter Duration' },
    { months: mediumTermMonths, label: 'Standard Duration' },
    { months: longTermMonths, label: 'Extended Duration' }
 ];
  
  for (let i = 0; i < timeOptions.length; i++) {
    const months = timeOptions[i].months
    const profit = monthlyProfitAtCurrentRate * months
    
    // For shorter duration, calculate required rate
    // Calculate the rate needed to meet the required profit for the given time (months)
    const requiredMonthlyProfitForTime = requiredProfit / months
    const requiredAnnualProfitForTime = requiredMonthlyProfitForTime * 12
    const neededRateForTime = (requiredAnnualProfitForTime / principal) * 100

    options.push({
      optionNumber: i + 1,
      optionLabel: timeOptions[i].label,
      timeInMonths: months,
      timeInYears: parseFloat((months / 12).toFixed(2)),
      interestRate: `${neededRateForTime.toFixed(2)}%`, // Always adjust rate to meet profit for this time
      annualProfit: formatINR(requiredAnnualProfitForTime),
      monthlyProfit: formatINR(requiredMonthlyProfitForTime),
      totalProfit: formatINR(requiredProfit), // Total profit remains the required profit
      totalProfitAmount: parseFloat(requiredProfit.toFixed(2)),
      totalAmount: formatINR(principal + requiredProfit),
      monthlyEMI: formatINR(calculateEMI(principal, neededRateForTime, months)),
      note: `Interest rate adjusted to ${neededRateForTime.toFixed(2)}% to meet benchmark profit for ${months} months.`
    })
  }
  
  return options
}

function calculateEMI(principal, annualInterestRate, timeInMonths) {
  if (annualInterestRate === 0) {
    return principal / timeInMonths;
  }
  const monthlyInterestRate = (annualInterestRate / 100) / 12;
  const emi = principal * monthlyInterestRate * Math.pow((1 + monthlyInterestRate), timeInMonths) / (Math.pow((1 + monthlyInterestRate), timeInMonths) - 1);
  return emi;
}